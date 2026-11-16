'use client';

import { useEffect, useRef, useState } from 'react';
import { feedbackLimit, type Meal, type Review } from '../../lib/contracts';
import { isDate, shiftDate } from '../../lib/date';

class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, {cache:'no-store', ...options});
  const body = await response.json();
  if (!response.ok) throw new RequestError(response.status, body.error);
  return body;
}
function send(method: string, data?: unknown): RequestInit {
  return {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)};
}
function message(error: unknown) {
  return error instanceof RequestError ? error.message : '연결 상태를 확인한 후 다시 시도해 주세요.';
}
const unauthorized = (error: unknown) => error instanceof RequestError && [401, 403].includes(error.status);
const clock = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const dateLabel = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', year:'numeric',month:'long',day:'numeric',weekday:'long'});
type Day = {date: string; meals: Meal[]; review: Review};

function PhotoGallery({meal}: {meal: Meal}) {
  const gallery = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const title = meal.title || meal.category || '식단';
  function photo(src: string, position: number) {
    return failed.includes(src) ? <span className="photo-unavailable">사진을 불러올 수 없습니다.</span> :
      // This same-origin media route checks the browser's session on every request.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={title + ' 사진 ' + (position + 1)} loading="lazy" onError={() => setFailed(previous => [...previous, src])}/>;
  }
  if (!meal.images.length) return null;
  return <>
    <div className="photos">
      {meal.images.map((src, position) => <button className="photo" type="button" key={src}
        aria-label={title + ' 사진 ' + (position + 1) + ' 크게 보기'}
        onClick={() => {setIndex(position); gallery.current?.showModal();}}>{photo(src, position)}</button>)}
    </div>
    <dialog ref={gallery} aria-label={title + ' 사진 모아보기'}>
      <div className="gallery-controls">
        <button onClick={() => gallery.current?.close()}>닫기</button>
      </div>
      <div className="gallery-image">{photo(meal.images[index], index)}</div>
      {meal.images.length > 1 && <div className="gallery-controls">
        <button disabled={index === 0} onClick={() => setIndex(index - 1)}>이전 사진</button>
        <span aria-live="polite">{index + 1} / {meal.images.length}</span>
        <button disabled={index === meal.images.length - 1} onClick={() => setIndex(index + 1)}>다음 사진</button>
      </div>}
    </dialog>
  </>;
}

function MealCard({meal}: {meal: Meal}) {
  return <article className="meal">
    <div className="meal-details">
      <div className="meal-meta">
        {meal.category && <span className="pill">{meal.category}</span>}
        <span>{clock.format(new Date(meal.startAt))}{meal.endAt && ' – ' + clock.format(new Date(meal.endAt))}</span>
        {meal.displayDuration && <span className={meal.displayDuration === '시간 확인 필요' ? 'error' : ''}>{meal.displayDuration}</span>}
      </div>
      <h3>{meal.title || meal.category || '식단'}</h3>
      {meal.foods && <p>{meal.foods}</p>}
      {meal.sharedNote && <p className="shared-note">{meal.sharedNote}</p>}
    </div>
    <PhotoGallery meal={meal}/>
  </article>;
}

export function ReviewScreen({initialDate, owner}: {initialDate: string; owner: boolean}) {
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [date, setDate] = useState(initialDate);
  const [revision, setRevision] = useState(0);
  const [day, setDay] = useState<Day | null>(null);
  const [drafts, setDrafts] = useState<Record<string,string>>({});
  const [phase, setPhase] = useState<'loading'|'ready'|'denied'|'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const auth = useRef<Promise<unknown> | null>(null);
  const linkToken = useRef<string | null>(null);

  function connect() {
    if (!linkToken.current) return;
    auth.current = request('/auth/link', send('POST', {token:linkToken.current})).then(() => {
      linkToken.current = null;
    });
    void auth.current.catch(error => {
      if (unauthorized(error)) linkToken.current = null;
    });
  }

  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    history.replaceState(history.state, '', location.pathname + location.search);
    if (!owner && fragment.has('token') && !auth.current) {
      linkToken.current = fragment.get('token') || 'invalid';
      connect();
    }
  }, [owner]);

  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    const options = {signal:controller.signal};
    async function load() {
      try {
        if (auth.current) await auth.current;
        const [result, review] = await Promise.all([
          request<{meals:Meal[]}>('/meals?date=' + date, options),
          request<Review>('/reviews/' + date, options),
        ]);
        if (controller.signal.aborted) return;
        setDay({date, meals:result.meals, review});
        setPhase('ready');
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(message(error));
        setPhase(unauthorized(error) ? 'denied' : 'error');
      }
    }
    void load();
    return () => controller.abort();
  }, [date, revision]);

  function navigate(next: string) {
    if (saving || next === date || !isDate(next) || next === '9999-12-31') return;
    setPhase('loading');
    setDay(null);
    setSaveError('');
    setSaved(false);
    setDate(next);
  }
  function reload() {
    connect();
    setPhase('loading');
    setDay(null);
    setRevision(previous => previous + 1);
  }

  const current = day?.date === date ? day : null;
  const feedback = drafts[date] ?? current?.review.feedback ?? '';
  const editable = !!current && (current.meals.length > 0 || current.review.status === 'saved');

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || !feedback.trim() || saving) return;
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const review = await request<Review>('/reviews/' + date, send('PUT', {feedback}));
      setDay(previous => previous?.date === date ? {...previous, review} : previous);
      setDrafts(previous => {
        const next = {...previous};
        delete next[date];
        return next;
      });
      setSaved(true);
    } catch (error) {
      if (unauthorized(error)) {
        setDay(null);
        setLoadError(message(error));
        setPhase('denied');
      } else {
        setSaveError(message(error));
      }
    } finally {
      setSaving(false);
    }
  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || loggingIn) return;
    setLoggingIn(true);
    setLoginError('');
    try {
      await request('/auth/owner', send('POST', {password}));
      setPassword('');
      reload();
    } catch (error) {
      setLoginError(message(error));
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    setSaveError('');
    try {
      await request('/auth/logout', send('POST'));
      setDay(null);
      setDrafts({});
      setLoadError('다시 접속하려면 강사 전용 링크를 열어 주세요.');
      setPhase('denied');
    } catch (error) {
      setSaveError(message(error));
    } finally {
      setLoggingOut(false);
    }
  }

  return <main>
    <header>
      <div className="top"><span className="brand">MEAL NOTE</span>
        {phase === 'ready' && <button className="quiet" disabled={saving || loggingOut} onClick={logout}>접속 종료</button>}
      </div>
      <h1>하루 식단 리뷰</h1>
      <p>공유된 식단을 확인하고 하루 총평을 남겨주세요.</p>
    </header>
    {phase === 'denied' && owner ? <form className="panel owner-login" onSubmit={login}>
      <h2>소유자 로그인</h2>
      <label htmlFor="owner-password">비밀번호</label>
      <input id="owner-password" type="password" autoComplete="current-password" maxLength={256}
        value={password} onChange={event => setPassword(event.target.value)} required/>
      <button className="save" disabled={loggingIn || !password}>{loggingIn ? '로그인 중…' : '로그인'}</button>
      {loginError && <p role="alert" className="error">{loginError}</p>}
    </form> : phase === 'denied' ? <section className="panel"><h2>접근할 수 없습니다</h2><p role="alert">{loadError}</p></section> :
      <>
        <nav className="datebar" aria-label="리뷰 날짜 선택">
          <button aria-label="이전 날짜" disabled={saving || loggingOut || !date || date === '0001-01-01'} onClick={() => navigate(shiftDate(date, -1))}>‹</button>
          <div className="datefield">
            <label htmlFor="review-date">{date ? dateLabel.format(new Date(date + 'T00:00:00+09:00')) : '리뷰 날짜'}</label>
            <input id="review-date" aria-label="리뷰 날짜" type="date" min="0001-01-01" max="9999-12-30" value={date} disabled={saving || loggingOut} onChange={event => navigate(event.target.value)}/>
          </div>
          <button aria-label="다음 날짜" disabled={saving || loggingOut || !date || date === '9999-12-30'} onClick={() => navigate(shiftDate(date, 1))}>›</button>
        </nav>
        {phase === 'loading' && <p className="panel" role="status">식단과 총평을 불러오는 중입니다.</p>}
        {phase === 'error' && <section className="panel"><h2>기록을 불러올 수 없습니다</h2><p role="alert">{loadError}</p><button onClick={reload}>다시 불러오기</button></section>}
        {phase === 'ready' && current && <>
          <section aria-labelledby="meals-heading">
            <div className="section-heading"><h2 id="meals-heading">공유된 식단</h2><span className="pill">{current.meals.length}건</span></div>
            {current.meals.length ? <div className="meal-list">{current.meals.map(meal => <MealCard key={meal.id} meal={meal}/>)}</div> :
              <div className="panel empty"><strong>공유된 식단이 없습니다</strong><p>해당 날짜에 공유된 식단 기록이 없습니다.</p></div>}
          </section>
          <form className="panel review" onSubmit={save}>
            <h2><label htmlFor="feedback">하루 총평</label></h2>
            <textarea id="feedback" rows={5} maxLength={feedbackLimit} value={feedback} disabled={!editable || saving || loggingOut}
              placeholder="식사 구성, 개선할 점, 다음 식사에 대한 제안을 작성해 주세요."
              onChange={event => {
                const value = event.target.value;
                setDrafts(previous => ({...previous, [date]:value}));
                setSaved(false);
                setSaveError('');
              }}/>
            {!editable && <p>공유된 식단이 있는 날에 새 총평을 작성할 수 있습니다.</p>}
            <div className="review-footer">
              <span role="status" className={saved ? 'success' : ''}>
                {saving ? '저장 중…' : saved ? '저장 완료' : current.review.status === 'saved' ? '작성 완료' : '미작성'}
              </span>
              <button className="save" disabled={!editable || !feedback.trim() || saving || loggingOut || feedback.trim() === current.review.feedback}>
                {saveError ? '다시 저장' : current.review.status === 'saved' ? '수정 저장' : '총평 저장'}
              </button>
            </div>
            {saveError && <p role="alert" className="error">{saveError}</p>}
          </form>
        </>}
      </>}
  </main>;
}

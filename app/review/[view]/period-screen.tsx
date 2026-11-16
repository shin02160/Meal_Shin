'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { feedbackLimit } from '../../../lib/contracts';
import { isDate, shiftDate } from '../../../lib/date';
import { periodFor, periodKey, type PeriodType } from '../../../lib/period';
import type { Claim, ReportVersion, ReportView } from '../../../lib/report-contracts';
import { call, errorText } from './api';

type View = ReportView & {latestVersion:number};
type History = {id:string;version:number;confirmedAt?:string;hidden:true} | ReportVersion;

function Claims({label,claims,row}:{label:string;claims:Claim[];row:ReportVersion}) {
  if (!claims.length) return null;
  return <section><h3>{label}</h3><ul>{claims.map((claim,index) => <li key={index}>
    <p>{claim.text}</p>
    <span className="evidence">{claim.evidence.map(id => {
      const ref = row.sources.find(source=>source.id === id);
      return ref ? <Link key={id} href={'/review?date=' + ref.date}>{ref.date} {ref.kind === 'meal' ? '식단' : '일별 총평'}</Link> :
        <a key={id} href={'https://www.notion.so/' + id.replaceAll('-','')}>확정 주간 리뷰</a>;
    })}</span>
  </li>)}</ul></section>;
}

export function PeriodScreen({type,initialKey}:{type:PeriodType;initialKey:string}) {
  const [key,setKey] = useState(initialKey);
  const [view,setView] = useState<View|null>(null);
  const [refresh,setRefresh] = useState(0);
  const [feedback,setFeedback] = useState('');
  const [dirty,setDirty] = useState(false);
  const [pending,setPending] = useState(false);
  const [loadError,setLoadError] = useState('');
  const [error,setError] = useState('');
  const [status,setStatus] = useState('');
  const [history,setHistory] = useState<History[]|null>(null);
  const [confirming,setConfirming] = useState(false);
  const period = periodFor(type,key);
  const active = view?.period.key === key ? view : null;
  const current = active?.current;
  const final = active?.final;
  const edit = current && current.state !== '확정' && !active?.currentStale;
  const sourceId = current?.id ?? active?.historyId;

  useEffect(() => {
    const controller = new AbortController();
    call<View>('reports?type=' + type + '&key=' + key,'GET',undefined,controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setView(data);
      setFeedback(data.current?.feedback ?? '');
      setDirty(false);
      setLoadError('');
    }).catch(reason => { if (!controller.signal.aborted) setLoadError(errorText(reason)); });
    return () => controller.abort();
  },[type,key,refresh]);

  function change(value:string) {
    if (pending || confirming) return;
    try { periodFor(type,value); } catch { return; }
    if (value === key) return;
    if (dirty && !window.confirm('저장하지 않은 수정 내용을 버리고 기간을 변경하시겠어요?')) return;
    setKey(value); setView(null); setLoadError(''); setError(''); setStatus(''); setHistory(null);
  }

  async function action(work:()=>Promise<void>, result:string) {
    if (pending) return;
    setPending(true); setError(''); setStatus('');
    try { await work(); setStatus(result); }
    catch (reason) { setError(errorText(reason)); }
    finally {setPending(false);}
  }

  function regenerate() {
    if (!active) return;
    if (dirty && !window.confirm('저장하지 않은 수정 내용을 버리고 새 초안을 생성하시겠어요?')) return;
    void action(async () => {
      const row = await call<ReportVersion>('reports/generate','POST',{
        type,key,regenerate:active.latestVersion > 0,expectedVersion:active.latestVersion,
      });
      setView({...active,current:row,latestVersion:row.version,currentStale:false});
      setFeedback(row.feedback); setDirty(false);
    },'AI 초안을 생성했습니다.');
  }

  function save(confirm:boolean) {
    if (!current || !active) return;
    void action(async () => {
      const row = await call<ReportVersion>('reports/' + current.id + (confirm ? '/confirm' : ''),confirm ? 'POST' : 'PATCH',{
        feedback,expectedVersion:current.version,expectedRevision:current.revision,
      });
      setView({...active,current:row,final:confirm ? row : active.final,needsReview:confirm ? false : active.needsReview});
      setFeedback(row.feedback); setDirty(false); setConfirming(false); setHistory(null);
    },confirm ? '총평을 확정했습니다.' : '검토 내용을 저장했습니다.');
  }

  return <>
    <nav className="datebar" aria-label="분석 기간 선택">
      <button aria-label="이전 기간" disabled={pending || confirming} onClick={()=>change(periodKey(type,shiftDate(period.start,-1)))}>‹</button>
      <div className="period-label"><label htmlFor="period-selector">분석 기간</label>
        <input id="period-selector" type="date" value={period.start}
          disabled={pending || confirming} onChange={event=>{if (isDate(event.target.value)) change(periodKey(type,event.target.value));}}/>
        <span>{period.start} ~ {period.end}</span>
      </div>
      <button aria-label="다음 기간" disabled={pending || confirming} onClick={()=>change(periodKey(type,period.until))}>›</button>
    </nav>
    {!active && !loadError && <div className="panel skeleton" role="status">리포트를 불러오는 중입니다.</div>}
    {loadError && <section className="panel"><p role="alert" className="error">{loadError}</p>
      <button onClick={()=>{setLoadError('');setRefresh(refresh + 1);}}>다시 불러오기</button></section>}
    {active && <div className="period-stack">
      <section className="panel"><h2>공유 기록 집계</h2>
        {active.stats.mealCount === 0 && <p>공유된 식단 기록이 없습니다.</p>}
        <dl className="report-metrics">
          <div><dt>기록일</dt><dd>{active.stats.recordedDays}일</dd></div>
          <div><dt>식단</dt><dd>{active.stats.mealCount}건</dd></div>
          <div><dt>일별 총평</dt><dd>{active.stats.reviewCount}건</dd></div>
          <div><dt>평균 소요시간</dt><dd>{active.stats.durations.average === null ? '—' : active.stats.durations.average + '분'}</dd></div>
        </dl>
        {Object.entries(active.stats.starts).map(([category,hours])=><p key={category}>{category} · {Object.entries(hours).sort().map(([hour,count])=>hour + ' ' + count + '건').join(' / ')}</p>)}
        {type === 'monthly' && active.stats.weeks.map(week=><p key={week.key}>{week.key} · {week.recordedDays}일 / {week.mealCount}건</p>)}
        <ul>{active.stats.limitations.map(item=><li key={item}>{item}</li>)}</ul>
      </section>
      {active.daily.length > 0 && <section className="panel"><h2>일별 강사 의견</h2>
        {active.daily.map(row=><div key={row.id}><Link href={'/review?date='+row.date}>{row.date}</Link><p className="report-copy">{row.feedback}</p></div>)}
      </section>}
      <section className="panel period-stack">
        <div className="section-heading"><h2>기간 리포트</h2>{current && <span className="pill">v{current.version} {current.state}</span>}</div>
        {active.needsReview && <p role="status" className="error">원본 기록이 변경되어 재검토가 필요합니다.</p>}
        <div className="report-actions">
          <button className="save" disabled={pending || confirming || !active.stats.mealCount} onClick={regenerate}>{active.latestVersion ? '재분석' : 'AI 초안 생성'}</button>
          <button disabled={pending || confirming} onClick={()=>{if (!dirty || window.confirm('저장하지 않은 수정 내용을 버리시겠어요?')) {setView(null);setRefresh(refresh + 1);setHistory(null);}}}>새로고침</button>
        </div>
        {current && <details open={current.state !== '확정'}><summary>AI 초안 및 분석 근거</summary>
          <Claims label="AI 요약" claims={[current.draft.summary]} row={current}/>
          <Claims label="관찰 사실" claims={current.draft.observations} row={current}/>
          <Claims label="긍정적 변화" claims={current.draft.strengths} row={current}/>
          <Claims label="AI 해석" claims={current.draft.interpretations} row={current}/>
          <Claims label="AI 개선 제안" claims={current.draft.improvements} row={current}/>
          <Claims label="기존 목표 평가" claims={current.draft.goalAssessments} row={current}/>
          <Claims label="다음 기간 목표 제안" claims={current.draft.proposedGoals} row={current}/>
          {current.draft.limitations.map(item=><p key={item}>{item}</p>)}
        </details>}
        {edit && <>
          <label htmlFor="period-feedback">종합 총평</label>
          <textarea id="period-feedback" value={feedback} maxLength={feedbackLimit} disabled={pending || confirming}
            onChange={event=>{setFeedback(event.target.value);setDirty(true);}}/>
          <div className="report-actions">
            <button disabled={pending || confirming || !feedback.trim()} onClick={()=>save(false)}>초안 저장</button>
            <button className="save" disabled={pending || confirming || !feedback.trim()} onClick={()=>setConfirming(true)}>총평 확정</button>
          </div>
          {confirming && <section className="panel" aria-label="총평 확정 확인">
            <p>이 총평을 확정하고 버전 이력에 보관할까요?</p>
            <button disabled={pending} onClick={()=>setConfirming(false)}>취소</button>{' '}
            <button className="save" disabled={pending} onClick={()=>save(true)}>확정하기</button>
          </section>}
        </>}
        {final && <section><h3>확정 총평 · v{final.version}</h3><p className="report-copy">{final.feedback}</p>
          {final.draft.proposedGoals.map((goal,index)=><div className="goal-proposal" key={index}>
            <p>{goal.title} · {goal.text}</p>
            <button disabled={pending} onClick={()=>void action(async()=>{await call('goals','POST',{reportId:final.id,index});},'개선 목표에 제안을 추가했습니다.')}>목표로 추가</button>
          </div>)}</section>}
        {sourceId && <button disabled={pending || confirming} onClick={()=>void action(async()=>setHistory(await call<History[]>('reports/'+sourceId+'/history')),'확정 이력을 불러왔습니다.')}>확정 이력 보기</button>}
        {history && <section><h3>확정 이력</h3>{!history.length && <p>확정 이력이 없습니다.</p>}
          {history.map(row=><details key={row.id}><summary>v{row.version} · {row.confirmedAt?.slice(0,10)}</summary>
            {'hidden' in row ? <p>원본 공유 범위가 변경되어 내용을 표시할 수 없습니다.</p> : <p className="report-copy">{row.feedback}</p>}
          </details>)}
        </section>}
        {pending && <p role="status">요청을 처리하는 중입니다.</p>}
        {status && <p className="success" role="status">{status}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div>}
  </>;
}

'use client';

import Link from 'next/link';
import { useEffect,useState } from 'react';
import { progressStates,type GoalProgressSummary,type ProgressState,type ProgressSummary,type ProgressView,type ProgressDraft } from '../../../lib/progress-contracts';
import type { Goal } from '../../../lib/report-contracts';
import type { PeriodType } from '../../../lib/period';
import { call,errorText } from './api';

export function useProgressSummary(type:PeriodType,key:string,version=0,enabled=true):{items?:GoalProgressSummary[];error?:string} {
  const [result,setResult] = useState<{key:string;items?:GoalProgressSummary[];error?:string}>();
  useEffect(()=>{
    if (!enabled) return;
    const controller = new AbortController();
    call<GoalProgressSummary[]>('goals/progress-summary?type='+type+'&key='+key,'GET',undefined,controller.signal)
      .then(items=>{if (!controller.signal.aborted) setResult({key,items});})
      .catch(error=>{if (!controller.signal.aborted) setResult({key,error:errorText(error)});});
    return ()=>controller.abort();
  },[type,key,version,enabled]);
  return result?.key === key ? result : {};
}
function Counts({summary,onSelectDay}:{summary:ProgressSummary;onSelectDay?:(day:string)=>void}) {
  if (!summary.eligible) return <p>집계 대상 기간이 없습니다.</p>;
  const assessed = summary.achieved+summary.partial+summary.missed;
  return <>
    <p>실천율 {summary.rate === null ? '평가 데이터 없음' : summary.rate+'%'} · 평가 {assessed}일</p>
    <p>달성 {summary.achieved} · 부분달성 {summary.partial} · 미달성 {summary.missed} · 판단불가 {summary.unknown}</p>
    <p>사용자 확인 {summary.confirmed} · 미확인 {summary.drafts} · 미기록 {summary.unrecorded}</p>
    {summary.lastDay && <p>최근 기록 {summary.lastDay}</p>}
    <details><summary>날짜별 실천 결과</summary><ul>
            {summary.days.map(item=>{
        const label=item.day+' · '+(item.status ?? '미기록')+(item.draft ? ' · 미확인 기록 있음' : '');
        return <li key={item.day}>{onSelectDay ? <button onClick={()=>onSelectDay(item.day)}>{label}</button> : label}</li>;
      })}
    </ul></details>
  </>;
}
export function GoalProgressCard({goal,today,summary,summaryError,onSaved}:{
  goal:Goal;today:string;summary?:ProgressSummary;summaryError?:string;onSaved:()=>void;
}) {
  const [draft,setDraft]=useState<ProgressDraft|null>(null);
  const [day,setDay]=useState(today);
  const [view,setView]=useState<ProgressView|null>(null);
  const [status,setStatus]=useState<ProgressState>('판단불가');
  const [memo,setMemo]=useState('');
  const [opinion,setOpinion]=useState('');
  const [mealIds,setMealIds]=useState<string[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [pending,setPending]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const route='goals/'+goal.id+'/progress';
  useEffect(()=>{

    const controller=new AbortController();
    call<ProgressView>(route+'?day='+day,'GET',undefined,controller.signal).then(value=>{
      if (controller.signal.aborted) return;
      setView(value);setStatus(value.record?.status ?? '판단불가');setMemo(value.record?.memo ?? '');
      setOpinion(value.record?.opinion ?? '');setMealIds(value.record?.mealIds ?? []);setDraft(null);setDirty(false);
    }).catch(reason=>{if (!controller.signal.aborted) setError(errorText(reason));});
    return ()=>controller.abort();
  },[day,route,refresh]);
  useEffect(()=>{
    if (!dirty) return;
    function warn(event:BeforeUnloadEvent) {event.preventDefault();}
    function warnNavigation(event:MouseEvent) {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (anchor && !window.confirm('저장하지 않은 실천 기록을 버리시겠어요?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener('click',warnNavigation,true);
    window.addEventListener('beforeunload',warn);
    return ()=>{
      document.removeEventListener('click',warnNavigation,true);
      window.removeEventListener('beforeunload',warn);
    };
  },[dirty]);
  function discard() { return !dirty || window.confirm('저장하지 않은 실천 기록을 버리시겠어요?'); }
  function changeDay(value:string) {
    if (pending || !value || value === day || !discard()) return;
    setView(null);setError('');setNotice('');setDirty(false);setDay(value);
  }
  async function save(action:string) {
    if (!view || pending) return;
    if (action === 'remove' && !window.confirm('이 일별 기록을 목록에서 삭제하시겠어요?')) return;
    if (action === 'confirm' && (dirty || !view.record)) return;
    if (action === 'confirm' && !window.confirm('입력한 실천 결과를 확인하시겠어요?')) return;
    if (action === 'draft' && dirty && !discard()) return;
    setPending(true);setError('');setNotice('');
    try {
      const input={day,action,status,memo,opinion,mealIds,expectedRevision:view.record?.revision ?? ''};
      if (action === 'draft') {
        const result=await call<{draft:ProgressDraft}>(route,'POST',input);
        setDraft(result.draft);setStatus(result.draft.status);setMealIds(result.draft.mealIds);setDirty(true);
        setNotice('AI 초안을 생성했습니다. 내용을 검토한 뒤 기록을 저장해 주세요.');
        return;
      }
      await call(route,'POST',{...input,...(draft && action === 'save' ? {draftId:draft.id} : {})});
      setDirty(false);setView(null);setRefresh(value=>value+1);onSaved();
      setNotice(action === 'remove' ? '기록을 삭제했습니다.' : '실천 기록을 저장했습니다.');
    } catch (reason) {setError(errorText(reason));}
    finally {setPending(false);}
  }

  const confirmed=view?.record?.confirmed;
  const editable=view && !view.hidden && !confirmed && !pending;
  return <section className="period-stack">
    <h3>이번 주 실천 현황</h3>
    {summary ? <Counts summary={summary} onSelectDay={changeDay}/> : <p>{summaryError ?? '실천 현황을 불러오는 중입니다.'}</p>}
    {goal.evaluatedAt && <p>최근 평가일 {goal.evaluatedAt.slice(0,10)}</p>}
    <div className="panel period-stack">
      <h3>일별 기록</h3>
      <label htmlFor={'progress-day-'+goal.id}>평가 날짜</label>
      <input id={'progress-day-'+goal.id} type="date" value={day} disabled={pending} onChange={event=>changeDay(event.target.value)}/>
      {!view && !error && <p role="status">일별 기록을 불러오는 중입니다.</p>}
      {view?.hidden && <p>관련 식단의 공유가 해제되어 기록 내용을 표시할 수 없습니다.</p>}
      {view && !view.hidden && <>
        {confirmed && <p className="pill">사용자 확인 완료</p>}
        <label htmlFor={'progress-state-'+goal.id}>달성 상태</label>
        <select id={'progress-state-'+goal.id} value={status} disabled={!editable || !view.meals.length} onChange={event=>{
          setStatus(event.target.value as ProgressState);setDirty(true);
        }}>{progressStates.map(item=><option key={item}>{item}</option>)}</select>
        {!view.meals.length && <p>공유 식단이 없어 달성 여부를 판단할 수 없습니다.</p>}
        {view.meals.length>0 && <fieldset disabled={!editable}><legend>관련 식단</legend>
          {view.meals.map(meal=><div className="goal-meal" key={meal.id}><label><input type="checkbox" checked={mealIds.includes(meal.id)} onChange={event=>{
            setMealIds(previous=>event.target.checked ? [...previous,meal.id] : previous.filter(id=>id!==meal.id));setDirty(true);
          }}/> <span>{meal.category && meal.category+' · '}{new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(meal.startAt))} · {meal.title}</span></label><Link href={'/review?date='+day}>식단 보기</Link></div>)}

        </fieldset>}
        {(draft?.evidence || view.record?.evidence) && <section>
          <h3>{draft ? '미저장 AI 초안' : 'AI 평가 근거'}</h3>
          <p className="report-copy">{draft?.evidence ?? view.record?.evidence}</p>
        </section>}
        {dirty && <p role="status">{view.record ? '수정 내용이 있습니다. 저장 후 확인해 주세요.' : '저장하지 않은 기록입니다.'}</p>}
        <label htmlFor={'progress-memo-'+goal.id}>사용자 메모</label>
        <textarea id={'progress-memo-'+goal.id} value={memo} maxLength={1200} disabled={!editable}
          onChange={event=>{setMemo(event.target.value);setDirty(true);}}/>
        <div className="report-actions">
          {confirmed ? <button disabled={pending} onClick={()=>void save('restart')}>재평가 시작</button> : <>
            <button disabled={pending} onClick={()=>void save('draft')}>AI 초안 생성</button>
            <button className="save" disabled={pending} onClick={()=>void save('save')}>기록 저장</button>
            <button disabled={pending || dirty || !view.record} onClick={()=>void save('confirm')}>사용자 확인</button>
            {view.record && !view.history.some(item=>item.confirmed) && <button disabled={pending} onClick={()=>void save('remove')}>기록 삭제</button>}
          </>}
        </div>
        {view.record && <>
          <label htmlFor={'progress-opinion-'+goal.id}>일별 강사 의견</label>
          <textarea id={'progress-opinion-'+goal.id} value={opinion} maxLength={1200} disabled={pending}
            onChange={event=>{setOpinion(event.target.value);setDirty(true);}}/>
          <div><button disabled={pending || !opinion.trim()} onClick={()=>void save('opinion')}>일별 강사 의견 저장</button></div>
        </>}
      </>}
      {!!view?.history.length && <details><summary>일별 기록 이력</summary><ol>
        {view.history.map(item=><li key={item.revision}>{item.status} · {item.confirmed ? '사용자 확인 완료' : item.source}
          {item.memo && <p>{item.memo}</p>}{item.evidence && <p>{item.evidence}</p>}{item.opinion && <p>{item.opinion}</p>}</li>)}
      </ol></details>}
      {notice && <p role="status" className="success">{notice}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  </section>;
}

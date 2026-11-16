'use client';

import { useEffect, useState } from 'react';
import { goalStates, type Goal, type ReportView } from '../../../lib/report-contracts';
import { periodKey, type PeriodType } from '../../../lib/period';
import { call, errorText } from './api';

function GoalCard({goal,today,onSaved}:{goal:Goal;today:string;onSaved:(goal:Goal)=>void}) {
  const [status,setStatus] = useState(goal.status);
  const [opinion,setOpinion] = useState('');
  const [evaluation,setEvaluation] = useState('');
  const [periodType,setPeriodType] = useState<PeriodType>('weekly');
  const [periodDate,setPeriodDate] = useState(today);
  const [pending,setPending] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');

  async function save(approve:boolean) {
    setPending(true);setError('');setNotice('');
    try {
      let reportId = '';
      if (evaluation.trim() && !approve) {
        const key = periodKey(periodType,periodDate);
        const report = await call<ReportView>('reports?type=' + periodType + '&key=' + key);
        if (!report.final) {setError('선택한 기간에 공개 가능한 확정 리포트가 없습니다.');return;}
        reportId = report.final.id;
      }
      const row = await call<Goal>('goals/' + goal.id,'PATCH',{
        expectedRevision:goal.revision,status:approve?'진행중':status,evaluation:approve?'':evaluation,reportId,approve,
      });
      onSaved(row);setNotice('저장했습니다.');setEvaluation('');setStatus(row.status);
    } catch (reason) {setError(errorText(reason));}
    finally {setPending(false);}
  }

  async function saveOpinion() {
    if (pending || !opinion.trim()) return;
    setPending(true);setError('');setNotice('');
    try {
      const row = await call<Goal>('goals/' + goal.id + '/opinion','POST',{opinion,expectedRevision:goal.revision});
      onSaved(row);setOpinion('');setNotice('강사 의견을 저장했습니다.');
    } catch (reason) {setError(errorText(reason));}
    finally {setPending(false);}
  }

  const latestOpinion = goal.history.findLast(event=>event.opinion)?.opinion;
  return <article className="panel">
    <div className="section-heading"><h2>{goal.title}</h2><span className="pill">{goal.status}</span></div>
    <p>{goal.kind} · {goal.criteria}</p>
    {goal.evaluation && <p className="report-copy">{goal.evaluation}</p>}
    {!goal.approved && <button className="save" disabled={pending} onClick={()=>void save(true)}>목표 승인</button>}
    {goal.approved && goal.status !== '종료' && <form onSubmit={event=>{event.preventDefault();void save(false);}}>
      <label htmlFor={'state-'+goal.id}>진행 상태</label>
      <select id={'state-'+goal.id} value={status} disabled={pending} onChange={e=>setStatus(e.target.value)}>
        {goalStates.filter(s=>s !== '제안').map(s=><option key={s}>{s}</option>)}
      </select>
      <label htmlFor={'evaluation-'+goal.id}>실천 평가</label>
      <textarea id={'evaluation-'+goal.id} value={evaluation} maxLength={1200} disabled={pending} onChange={e=>setEvaluation(e.target.value)}/>
      {evaluation.trim() && <div className="report-actions">
        <label>근거 리포트 <select value={periodType} disabled={pending} onChange={e=>setPeriodType(e.target.value as PeriodType)}><option value="weekly">주간</option><option value="monthly">월간</option></select></label>
        <label>포함 날짜 <input type="date" value={periodDate} required disabled={pending} onChange={e=>setPeriodDate(e.target.value)}/></label>
      </div>}
      <button className="save" disabled={pending}>목표 업데이트</button>
    </form>}
    <form onSubmit={event=>{event.preventDefault();void saveOpinion();}}>
      <label htmlFor={'opinion-'+goal.id}>강사 의견</label>
      {latestOpinion && <p className="report-copy">{latestOpinion}</p>}
      <textarea id={'opinion-'+goal.id} value={opinion} maxLength={1200} disabled={pending} onChange={e=>setOpinion(e.target.value)}/>
      <button className="save" disabled={pending || !opinion.trim()}>강사 의견 저장</button>
    </form>
    {goal.history.length > 0 && <details><summary>변경 이력</summary>
      <ul>{goal.history.map((event,index)=><li key={index}>{event.at.slice(0,10)} · {event.status}
        {event.evaluation && <p className="report-copy">{event.evaluation}</p>}
        {event.opinion && <p className="report-copy">강사 의견 · {event.opinion}</p>}
        {event.reportId && <a href={'https://www.notion.so/'+event.reportId.replaceAll('-','')}>근거 리포트</a>}
      </li>)}</ul>
    </details>}
    {notice && <p role="status" className="success">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </article>;
}

export function GoalsScreen({today}:{today:string}) {
  const [goals,setGoals] = useState<Goal[]|null>(null);
  const [error,setError] = useState('');
  const [refresh,setRefresh] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    call<Goal[]>('goals','GET',undefined,controller.signal).then(items=>{if (!controller.signal.aborted) setGoals(items);})
      .catch(reason=>{if (!controller.signal.aborted) setError(errorText(reason));});
    return ()=>controller.abort();
  },[refresh]);
  if (error) return <section className="panel"><p role="alert" className="error">{error}</p>
    <button onClick={()=>{setError('');setRefresh(refresh+1);}}>다시 불러오기</button></section>;
  if (!goals) return <p className="panel skeleton" role="status">개선 목표를 불러오는 중입니다.</p>;
  return <div className="period-stack">
    {!goals.length && <p className="panel">아직 등록된 개선 목표가 없습니다. 확정한 주간·월간 리뷰에서 목표를 추가할 수 있습니다.</p>}
    {goals.map(goal=><GoalCard key={goal.id} goal={goal} today={today}
      onSaved={row=>setGoals(previous=>previous?.map(item=>item.id === row.id ? row : item) ?? null)}/>)}
  </div>;
}

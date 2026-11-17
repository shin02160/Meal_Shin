'use client';

import { useEffect, useState } from 'react';
import { goalStates, type Goal, type ReportView } from '../../../lib/report-contracts';
import { periodKey, type PeriodType } from '../../../lib/period';
import { call, errorText } from './api';
import { RecentGoalAssessment } from './recent-goal-assessment';
import { GoalProgressCard, useProgressSummary } from './progress-screen';

function GoalCard({goal,today,onSaved,progress,onProgressSaved}:{goal:Goal;today:string;onSaved:(goal:Goal)=>void;progress:ReturnType<typeof useProgressSummary>;onProgressSaved:()=>void}) {
  const [status,setStatus] = useState(goal.status);
  const [opinion,setOpinion] = useState('');
  const [evaluation,setEvaluation] = useState('');
  const [periodType,setPeriodType] = useState<PeriodType>('weekly');
  const [periodDate,setPeriodDate] = useState(today);
  const [pending,setPending] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');

  async function save() {
    setPending(true);setError('');setNotice('');
    try {
      let reportId = '';
      if (evaluation.trim()) {
        const key = periodKey(periodType,periodDate);
        const report = await call<ReportView>('reports?type=' + periodType + '&key=' + key);
        if (!report.final) {setError('선택한 기간에 공개 가능한 확정 리포트가 없습니다.');return;}
        reportId = report.final.id;
      }
      const row = await call<Goal>('goals/' + goal.id,'PATCH',{
        expectedRevision:goal.revision,status,evaluation,reportId,
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
  return <article className="panel goal-detail">
    <div className="section-heading"><h2>{goal.title}</h2><span className="pill">{goal.status}</span></div>

    <GoalProgressCard goal={goal} today={today} summary={progress.items?.find(item=>item.goalId===goal.id)?.summary} summaryError={progress.error} onSaved={onProgressSaved}/>
    <details className="goal-settings">
    <summary>목표 관리</summary>
    <p>{goal.kind} · {goal.criteria}</p>
    {goal.source && <p className="report-copy">최초 근거 · {goal.source}</p>}
    {goal.evaluation && <p className="report-copy">{goal.evaluation}</p>}
    {goal.status !== '종료' && <form onSubmit={event=>{event.preventDefault();void save();}}>
      <label htmlFor={'state-'+goal.id}>진행 상태</label>
      <select id={'state-'+goal.id} value={status} disabled={pending} onChange={e=>setStatus(e.target.value)}>
        {goalStates.map(s=><option key={s}>{s}</option>)}
      </select>
      <label htmlFor={'evaluation-'+goal.id}>실천 평가</label>
      <textarea id={'evaluation-'+goal.id} value={evaluation} maxLength={1200} disabled={pending} onChange={e=>setEvaluation(e.target.value)}/>
      {evaluation.trim() && <div className="report-actions">
        <label>근거 리포트 <select value={periodType} disabled={pending} onChange={e=>setPeriodType(e.target.value as PeriodType)}><option value="weekly">주간</option><option value="monthly">월간</option></select></label>
        <label>포함 날짜 <input type="date" value={periodDate} required disabled={pending} onChange={e=>setPeriodDate(e.target.value)}/></label>
      </div>}
      <button className="save" disabled={pending}>목표 업데이트</button>
    </form>}
    </details>
    <section className="goal-settings"><h3>목표 강사 의견</h3>
    <form onSubmit={event=>{event.preventDefault();void saveOpinion();}}>
      <label htmlFor={'opinion-'+goal.id}>강사 의견</label>
      {latestOpinion && <p className="report-copy">{latestOpinion}</p>}
      <textarea id={'opinion-'+goal.id} value={opinion} maxLength={1200} disabled={pending} onChange={e=>setOpinion(e.target.value)}/>
      <button className="save" disabled={pending || !opinion.trim()}>강사 의견 저장</button>
    </form>
    </section>
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
  const [selected,setSelected] = useState<string|null>(null);
  const [filter,setFilter] = useState('전체');
  const [goals,setGoals] = useState<Goal[]|null>(null);
  const [error,setError] = useState('');
  const [refresh,setRefresh] = useState(0);
  const [progressVersion,setProgressVersion] = useState(0);
  const progress = useProgressSummary('weekly',periodKey('weekly',today),progressVersion,true);
  useEffect(()=>{
    const controller = new AbortController();
    call<Goal[]>('goals','GET',undefined,controller.signal).then(items=>{if (!controller.signal.aborted) setGoals(items);})
      .catch(reason=>{if (!controller.signal.aborted) setError(errorText(reason));});
    return ()=>controller.abort();
  },[refresh]);
  if (error) return <section className="panel"><p role="alert" className="error">{error}</p>
    <button onClick={()=>{setError('');setRefresh(refresh+1);}}>다시 불러오기</button></section>;
  if (!goals) return <p className="panel skeleton" role="status">개선 목표를 불러오는 중입니다.</p>;
  const active = goals.find(goal=>goal.id===selected);
  if (active) return <div className="period-stack">
    <a href="#goal-list" className="goal-back" onClick={event=>{
      event.preventDefault();
      setSelected(null);
    }}>← 개선 목표 목록</a>
    <GoalCard key={active.id} goal={active} today={today} progress={progress} onProgressSaved={()=>setProgressVersion(value=>value+1)}
      onSaved={row=>{setGoals(previous=>previous?.map(item=>item.id === row.id ? row : item) ?? null);setProgressVersion(value=>value+1);}}/>
  </div>;
  const visible = goals.filter(goal=>filter === '전체' || goal.status === filter);
  return <div className="period-stack" id="goal-list">
    <div className="goal-list-filter"><label htmlFor="goal-filter">상태</label>
      <select id="goal-filter" value={filter} onChange={event=>setFilter(event.target.value)}>
        {['전체',...goalStates].map(state=><option key={state}>{state}</option>)}
      </select><span>{visible.length}개 목표</span>
    </div>
    {!visible.length && <p className="panel">이 상태에 해당하는 목표가 없습니다.</p>}
    {visible.map(goal=>{
      const entry=progress.items?.find(item=>item.goalId===goal.id);
      const stats=entry?.summary;
      const recent=entry?.latest;
      const days=stats ? stats.achieved+stats.partial+stats.missed : 0;
      return <article key={goal.id} className="panel goal-list-card">
        <div className="section-heading"><h2>{goal.title}</h2><span className="pill">{goal.status}</span></div>
        <p>이번 주 · {stats?.rate != null ? '평가 '+days+'일 / 달성률 '+stats.rate+'%' : '평가 데이터 없음'}</p>
        <RecentGoalAssessment assessment={recent}/>
        {progress.error && <p className="error" role="alert">{progress.error}</p>}
        <button className="save" onClick={()=>setSelected(goal.id)} aria-label={goal.title+' 달성 기록 관리'}>달성 기록 관리</button>
      </article>;
    })}
  </div>;
}

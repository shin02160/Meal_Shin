import { randomUUID } from 'node:crypto';
import { collectPeriod } from './analysis-input';
import { isDate, shiftDate } from './date';
import { HttpError, required } from './errors';
import { mealsFor, notion, queryNotion, text, type Page } from './notion';
import { kstDate, type Period } from './period';
import { publicGoals } from './period-reviews';
import { progressDraft } from './progress-ai';
import { progressStates, type Progress, type ProgressState, type ProgressSummary } from './progress-contracts';
import type { Goal } from './report-contracts';
import { race, uuid, withReportLock } from './report-storage';

const source = () => required('NOTION_GOAL_PROGRESS_DATA_SOURCE_ID');
export const progressFields = {
  '평가 날짜':'date','개선 목표':'relation','관련 식단':'relation','달성 상태':'select','AI 평가 근거':'rich_text',
  '사용자 확인':'checkbox','사용자 메모':'rich_text','강사 의견':'rich_text','평가 출처':'select','평가 기준 버전':'rich_text',
};
type Snapshot = Omit<Progress,'historyCount'>;
type Meta = {criterion:string; revision:string; deleted:boolean; history:Snapshot[]};
type Entry = {record:Progress; meta:Meta};
const legacyMeta = (page:Page):Meta => ({criterion:'GP-1.0',revision:page.last_edited_time ?? '',deleted:false,history:[]});
const rich = (value:string) => {
  const chars = Array.from(value);
  const rich_text = [];
  for(let i=0;i<chars.length;i+=900) rich_text.push({type:'text',text:{content:chars.slice(i,i+900).join('')}});
  if (rich_text.length > 100) throw new HttpError(422,'기록 이력의 저장 한도를 초과했습니다.');
  return {rich_text};
};
function decode(page:Page):Entry {
  const p = page.properties;
  const value = text(p['평가 기준 버전']?.rich_text);
  const meta:Meta = value.startsWith('{') ? JSON.parse(value) : legacyMeta(page);
  if (p['관련 식단']?.has_more) throw new HttpError(409,'관련 식단 개수가 확인 가능한 한도를 초과했습니다.');
  const status = p['달성 상태']?.select?.name as ProgressState;
  const source = p['평가 출처']?.select?.name;
  return {meta,record:{
    id:page.id,goalId:p['개선 목표']?.relation?.[0]?.id ?? '',day:p['평가 날짜']?.date?.start ?? '',
    revision:meta.revision,status:progressStates.includes(status) ? status : '판단불가',
    mealIds:p['관련 식단']?.relation?.map(row=>row.id) ?? [],evidence:text(p['AI 평가 근거']?.rich_text),
    memo:text(p['사용자 메모']?.rich_text),opinion:text(p['강사 의견']?.rich_text),
    confirmed:p['사용자 확인']?.checkbox === true,
    source:source === 'AI 초안' || source === '강사 평가' ? source : '사용자 입력',historyCount:meta.history.length,
  }};
}
function validateDay(day:unknown) {
  if (typeof day !== 'string' || !isDate(day) || day === '9999-12-31') throw new HttpError(400,'평가 날짜를 확인해 주세요.');
  return day;
}
async function goalFor(id:string) {
  if (!uuid.test(id)) throw new HttpError(404,'목표를 찾을 수 없습니다.');
  const goal = (await publicGoals()).find(goal=>goal.id === id);
  if (!goal) throw new HttpError(404,'목표를 찾을 수 없습니다.');
  return goal;
}
async function one(goalId:string,day:string) {
  const rows = (await queryNotion(source(),progressFields,{and:[
    {property:'평가 날짜',date:{equals:day}},{property:'개선 목표',relation:{contains:goalId}},
  ]},2)).map(decode).filter(row=>row.record.goalId===goalId && row.record.day===day);
  if (rows.length > 1) throw race();
  return rows[0];
}
function safeRecord(entry:Entry|undefined, shared:Set<string>) {
  if (!entry || entry.meta.deleted) return null;
  const {record} = entry;
  if (record.mealIds.some(id=>!shared.has(id))) return null;
  return record;
}
export async function readProgress(goalId:string,date:unknown) {
  const day = validateDay(date);
  await goalFor(goalId);
  const [entry,meals] = await Promise.all([one(goalId,day),mealsFor(day)]);
  const record = safeRecord(entry,new Set(meals.map(meal=>meal.id)));
  const history = (entry?.meta.history ?? []).filter(row=>row.mealIds.every(id=>meals.some(meal=>meal.id===id)));
  return {record,history,meals:meals.map(({id,title})=>({id,title})),
    hidden:!!entry && !entry.meta.deleted && !record};
}

function shortText(value:unknown) {
  if (typeof value !== 'string' || value.length > 1200) throw new HttpError(400,'메모와 의견을 각각 1,200자 이하로 입력해 주세요.');
  return value.trim();
}
export async function saveProgress(goalId:string,body:Record<string,unknown>) {
  const day = validateDay(body.day);
  const action = body.action;
  if (action !== 'save' && action !== 'confirm' && action !== 'draft' && action !== 'restart' && action !== 'remove' && action !== 'opinion') {
    throw new HttpError(400,'평가 작업을 확인해 주세요.');
  }
  const goal = await goalFor(goalId);
  return withReportLock('progress:'+goalId+':'+day,async guard=>{
    const [entry,meals] = await Promise.all([one(goalId,day),mealsFor(day)]);
    const existing = entry?.record;
    const active = !!entry && !entry.meta.deleted;
    const shared = new Set(meals.map(meal=>meal.id));
    const current = safeRecord(entry,shared);
    if ((body.expectedRevision ?? '') !== (active ? existing?.revision : '')) throw race();
    if (active && !current) throw new HttpError(409,'공유가 해제된 식단이 있어 이 기록을 수정할 수 없습니다.');
    if (active && existing?.confirmed && action !== 'restart' && action !== 'opinion') {
      throw new HttpError(409,'확인된 기록은 재평가를 시작한 뒤 수정할 수 있습니다.');
    }
    if (action === 'remove' && entry?.meta.history.some(item=>item.confirmed)) {
      throw new HttpError(409,'이전에 확인된 평가가 있는 기록은 삭제할 수 없습니다.');
    }
    if ((action === 'remove' || action === 'restart' || action === 'opinion') && !current) throw race();
    const base:Progress = current ?? {id:'',goalId,day,revision:'',status:'판단불가',mealIds:[],
      confirmed:false,source:'사용자 입력',memo:'',opinion:'',evidence:'',historyCount:0};
    let next = {...base};
    if (action === 'draft') {
      const draft = meals.length && goal.criteria.trim() ? await progressDraft(goal.criteria,meals.slice(0,20).map(({startAt,foods})=>({startAt,foods:foods.slice(0,700)}))) :
        {status:'판단불가' as const,evidence:meals.length ? '목표의 실천 기준이 없어 판단할 수 없습니다.' : '공유된 식단 기록이 없습니다.'};
      const refreshed = await mealsFor(day);
      const signature = (items:typeof meals) => JSON.stringify(items.map(({id,startAt,foods})=>({id,startAt,foods})));
      if (signature(refreshed) !== signature(meals)) throw race();
      next = {...next,...draft,mealIds:meals.slice(0,20).map(meal=>meal.id),confirmed:false,source:'AI 초안'};
    } else if (action === 'save' || action === 'confirm') {
      if (!progressStates.includes(body.status as never)) throw new HttpError(400,'달성 상태를 확인해 주세요.');
      const requested = Array.isArray(body.mealIds) ? body.mealIds : [];
      if (requested.length > 20 || !requested.every(id=>typeof id === 'string' && shared.has(id))) {
        throw new HttpError(400,'선택한 날짜의 공유 식단만 연결할 수 있습니다.');
      }
      // Keep the inputs that explain any saved AI evidence.
      const selected = requested.length ? requested : meals.map(meal=>meal.id);
      const mealIds = [...new Set([...selected,...(base.evidence ? base.mealIds : [])])];
      if (mealIds.length > 20) throw new HttpError(400,'관련 식단은 최대 20개까지 연결할 수 있습니다.');
      next = {...next,status:meals.length ? body.status as ProgressState : '판단불가',
        mealIds,memo:shortText(body.memo ?? ''),confirmed:action === 'confirm',source:'사용자 입력'};
    } else if (action === 'opinion') {
      const opinion = shortText(body.opinion);
      if (!opinion) throw new HttpError(400,'강사 의견을 입력해 주세요.');
      next.opinion = opinion;
    } else if (action === 'restart') {
      next.confirmed = false;
    }
    const history = entry?.meta.history ?? [];
    if (current) {
      const {historyCount,...snapshot} = current;
      void historyCount;
      history.push(snapshot);
    }
    const meta:Meta = {criterion:'GP-1.0',revision:randomUUID(),deleted:action === 'remove',history};
    const properties = {
      '기록명':{title:rich(day+' · '+goal.title.slice(0,150)).rich_text},'평가 날짜':{date:{start:day}},
      '개선 목표':{relation:[{id:goalId}]},'관련 식단':{relation:next.mealIds.map(id=>({id}))},
      '달성 상태':{select:{name:next.status}},'AI 평가 근거':rich(next.evidence),'사용자 메모':rich(next.memo),
      '강사 의견':rich(next.opinion),'사용자 확인':{checkbox:next.confirmed},
      '평가 출처':{select:{name:next.source}},'평가 기준 버전':rich(JSON.stringify(meta)),
    };
    await guard.ensure();
    const write = () => existing ? notion<Page>('/pages/'+existing.id,'PATCH',{properties}) :
      notion<Page>('/pages','POST',{parent:{type:'data_source_id',data_source_id:source()},properties});
    const saved = existing ? await write() : await guard.create('progress:'+goalId+':'+day,write);
    return {record:meta.deleted ? null : decode(saved).record};
  });
}

function localDay(value:string) {
  if (isDate(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? kstDate(parsed) : '';
}
function eligibleOn(goal:Goal,day:string) {
  const start = localDay(goal.proposedAt);
  if (start && day < start) return false;
  const changes = goal.history.filter(event=>event.opinion === undefined && !event.legacy)
    .map(event=>({day:localDay(event.at),status:event.status})).filter(event=>event.day);
  const change = changes.findLast(event=>event.day<=day);
  const future = changes.find(event=>event.day>day);
  const status = change?.status ?? (future ? '제안' : goal.status);
  return status === '진행중' || status === '유지';
}
export function summarizeProgress(goal:Goal,period:Period,records:Progress[],today:string):ProgressSummary {
  const counts = {eligible:false,achieved:0,partial:0,missed:0,unknown:0,unrecorded:0,drafts:0,confirmed:0};
  const byDay = new Map(records.map(record=>[record.day,record]));
  const confirmedByDay = new Map(records.filter(record=>record.confirmed).map(record=>[record.day,record]));
  let lastDay:string|null = null;
  const days:ProgressSummary['days'] = [];
  for(let day=period.start;day<period.until && day<=today;day=shiftDate(day,1)){
    if (!eligibleOn(goal,day)) continue;
    counts.eligible = true;
    const record = byDay.get(day);
    const confirmed = confirmedByDay.get(day);
    days.push({day,status:confirmed?.status ?? record?.status ?? null,draft:!!record && !record.confirmed});
    if (!record) {counts.unrecorded++;continue;}
    lastDay = day;
    if (!record.confirmed) counts.drafts++;
    if (!confirmed) continue;
    counts.confirmed++;
    if (confirmed.status === '달성') counts.achieved++;
    else if (confirmed.status === '부분달성') counts.partial++;
    else if (confirmed.status === '미달성') counts.missed++;
    else counts.unknown++;
  }
  const denominator = counts.achieved+counts.partial+counts.missed;
  return {...counts,days,rate:denominator ? Math.round(counts.achieved/denominator*1000)/10 : null,lastDay};
}

export async function summarizeGoals(period:Period,today:string) {
  const [goals,input,pages] = await Promise.all([publicGoals(),collectPeriod(period),queryNotion(source(),progressFields,{and:[
    {property:'평가 날짜',date:{on_or_after:period.start}},{property:'평가 날짜',date:{before:period.until}},
  ]})]);
  const mealsByDay = new Map<string,Set<string>>();
  for (const meal of input.meals) {
    const ids=mealsByDay.get(meal.date) ?? new Set<string>();
    ids.add(meal.id);
    mealsByDay.set(meal.date,ids);
  }
  const grouped = new Map<string,Progress[]>();
  const seen = new Set<string>();
  for (const page of pages) {
    const entry = decode(page);
    const {goalId,day}=entry.record;
    if (day < period.start || day >= period.until) continue;
    const key=goalId+':'+day;
    if(seen.has(key)) throw race();
    seen.add(key);
    const mealIds=mealsByDay.get(day) ?? new Set<string>();
    const record=safeRecord(entry,mealIds);
    if(record) {
      const records=grouped.get(goalId) ?? [];
      const previous=entry.meta.history.findLast(item=>item.confirmed && item.mealIds.every(id=>mealIds.has(id)));
      if (!record.confirmed && previous) records.push({...previous,historyCount:0});
      records.push(record);
      grouped.set(goalId,records);
    }
  }
  return goals.map(goal=>({goalId:goal.id,title:goal.title,
    summary:summarizeProgress(goal,period,grouped.get(goal.id) ?? [],today)}));
}

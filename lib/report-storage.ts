import { randomUUID } from 'node:crypto';
import { redis } from './auth';
import { HttpError } from './errors';
import { NotionError, notion, queryNotion, text, type Page } from './notion';
import { periodFor, type Period } from './period';
import type { Goal, ReportVersion } from './report-contracts';

const reports = () => process.env.NOTION_PERIOD_REVIEW_DATA_SOURCE_ID || '41a6d8c5-8de1-813a-aa10-000ba10028e9';
const goals = () => process.env.NOTION_IMPROVEMENT_TRACKER_DATA_SOURCE_ID || '41a6d8c5-8de1-81f4-ad1a-000b48430769';
export const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const race = () => new HttpError(409, '다른 요청이 먼저 처리됐습니다. 새로고침 후 다시 시도해 주세요.');
const release = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0";
const renew = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) end return 0";
const claim = "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end if redis.call('SET',KEYS[2],ARGV[1],'NX') then return 1 end return 0";
const lease = 120000;

export async function withReportLock<T>(key: string, run: (guard: Lock) => Promise<T>): Promise<T> {
  const lock = 'meal:v12:lock:' + key;
  const owner = randomUUID();
  if (!await redis('SET',lock,owner,'NX','PX',lease)) throw race();
  const guard: Lock = {
    async ensure() { if (!await redis('EVAL',renew,1,lock,owner,lease)) throw race(); },
    async create(marker, write) {
      const pending = 'meal:v12:create:' + marker;
      await guard.ensure();
      if (!await redis('EVAL',claim,2,lock,pending,owner)) {
        throw new HttpError(409,'이 항목의 생성 결과를 확인 중입니다. 새로고침 후 다시 시도해 주세요.');
      }
      try {
        return await write();
      } catch (error) {
        if (error instanceof NotionError && [400,401,403,404,429].includes(error.upstreamStatus ?? 0)) {
          await redis('EVAL',release,1,pending,owner);
        }
        throw error;
      }
    },
  };
  try { return await run(guard); }
  finally { await redis('EVAL',release,1,lock,owner).catch(() => {}); }
}
type Lock = {ensure():Promise<void>; create<T>(marker:string, write:()=>Promise<T>):Promise<T>};

export async function limitWrites(key: string, max: number, seconds: number) {
  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
  if (await redis<number>('EVAL',script,1,'meal:v12:rate:' + key,seconds) > max) {
    throw new HttpError(429,'요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }
}

const reportFields = {
  '기간 키':'rich_text','분석 단위':'select','분석 버전':'number','분석 상태':'select','AI 분석 초안':'rich_text',
  '최종 종합 총평':'rich_text','분석 근거':'rich_text','확정 일시':'date','생성 일시':'date','데이터 지문':'rich_text',
  'AI 모델 정보':'rich_text','기간 시작일':'date','기간 종료일':'date',
};
const goalFields = {
  '개선 목표':'title','목표 ID':'rich_text','목표 유형':'select','목표 상태':'select','실천 기준':'rich_text',
  '최초 근거':'rich_text','최근 평가':'rich_text','강사 확정 여부':'checkbox','관련 리포트':'relation',
  '최초 제안일':'date','최종 평가일':'date',
};
function segments(value: string) {
  const characters = Array.from(value);
  const parts = [];
  for (let i=0; i<characters.length; i+=1000) {
    parts.push({type:'text',text:{content:characters.slice(i,i+1000).join('')}});
  }
  if (parts.length > 100) throw new HttpError(422,'보관할 내용이 너무 깁니다.');
  return parts;
}
const rich = (value:string) => ({rich_text:segments(value)});
const title = (value:string) => ({title:segments(value)});
const date = (start:string) => ({date:{start}});
const select = (name:string) => ({select:{name}});
const number = (value:number) => ({number:value});
const label = (p:Period) => p.type === 'weekly' ? '주간' : '월간';
function property(page: Page, name: string) { return text(page.properties[name]?.rich_text); }
function parse<T>(value: string): T {
  try { return JSON.parse(value); }
  catch { throw new HttpError(409,'Notion에 앱에서 읽을 수 없는 리포트 또는 목표가 있습니다. 원본을 확인해 주세요.'); }
}
async function createPage(source: string, properties: object, children?: object[]) {
  return notion<Page>('/pages','POST',{parent:{type:'data_source_id',data_source_id:source},properties,children});
}
async function ownedPage(source: string,id: string) {
  if (!uuid.test(id)) throw new HttpError(404,'항목을 찾을 수 없습니다.');
  const page = await notion<Page & {parent?:{data_source_id?:string}; in_trash?:boolean; archived?:boolean}>('/pages/' + id);
  if (page.parent?.data_source_id !== source || page.in_trash || page.archived) throw new HttpError(404,'항목을 찾을 수 없습니다.');
  return page;
}

const bodyMarker = 'meal-note:v1.2:body';
type ReportMeta = Pick<ReportVersion,'sources'|'stats'|'weeklyRefs'|'actor'>;
type ReportContent = {draft:ReportVersion['draft']; meta:ReportMeta};

function reportContent(row: Pick<ReportVersion,'draft'|'sources'|'stats'|'weeklyRefs'|'actor'>):ReportContent {
  return {draft:row.draft,meta:{sources:row.sources,stats:row.stats,weeklyRefs:row.weeklyRefs,actor:row.actor}};
}
function inPageBody(content:ReportContent) {
  return JSON.stringify(content).length > 12000;
}
function metadata(content:ReportContent) {
  const revision = randomUUID();
  return inPageBody(content) ? {revision} : {...content.meta,revision};
}

export async function decodeReport(page: Page):Promise<ReportVersion> {
  const stored = property(page,'AI 분석 초안');
  const envelope = parse<ReportMeta & {revision?:string}>(property(page,'분석 근거'));
  let content:ReportContent;
  if (stored === bodyMarker) {
    const blocks = await notion<{results:{type:string;paragraph?:{rich_text:{plain_text:string}[]}}[];next_cursor:string|null}>(
      '/blocks/' + page.id + '/children?page_size=100');
    if (blocks.next_cursor) throw race();
    content = parse(blocks.results.filter(block=>block.type === 'paragraph').map(block=>text(block.paragraph?.rich_text)).join(''));
  } else {
    content = {draft:parse(stored),meta:envelope};
  }
  const {draft,meta} = content;
  const state = page.properties['분석 상태']?.select?.name;
  const version = page.properties['분석 버전']?.number;
  if (!meta || !Array.isArray(meta.sources) || !Array.isArray(meta.weeklyRefs) || !meta.stats ||
      !version || !Number.isInteger(version) || (state !== 'AI 초안' && state !== '검토중' && state !== '확정')) throw race();
  return {id:page.id,version,state,revision:envelope?.revision ?? page.last_edited_time ?? '',
    createdAt:page.properties['생성 일시']?.date?.start ?? '',confirmedAt:page.properties['확정 일시']?.date?.start,
    draft, feedback:property(page,'최종 종합 총평'),
    fingerprint:property(page,'데이터 지문'),model:property(page,'AI 모델 정보'),
    sources:meta.sources,stats:meta.stats,weeklyRefs:meta.weeklyRefs,actor:'anonymous',
  };
}

export async function versions(period: Period) {
  const pages = await queryNotion(reports(),reportFields,{and:[
    {property:'기간 키',rich_text:{equals:period.key}}, {property:'분석 단위',select:{equals:label(period)}},
  ]});
  const rows = (await Promise.all(pages.map(decodeReport))).sort((a,b)=>b.version-a.version);
  if (new Set(rows.map(row=>row.version)).size !== rows.length) throw race();
  return rows;
}

export async function getReport(id: string) {
  const page = await ownedPage(reports(),id);
  const period = periodFor(page.properties['분석 단위']?.select?.name === '주간' ? 'weekly' : 'monthly',property(page,'기간 키'));
  return {period, row:await decodeReport(page)};
}

export async function writeDraft(period: Period, draft: Omit<ReportVersion,'id'|'revision'>) {
  const content = reportContent(draft);
  const useBody = inPageBody(content);
  const children = useBody ? segments(JSON.stringify(content)).map(part=>({type:'paragraph',paragraph:{rich_text:[part]}})) : undefined;
  return decodeReport(await createPage(reports(),{
    '리뷰명':title(period.key + ' ' + label(period) + ' v' + draft.version),
    '분석 단위':select(label(period)),'기간 키':rich(period.key),'기간 시작일':date(period.start),'기간 종료일':date(period.end),
    '분석 상태':select(draft.state),'분석 버전':number(draft.version),'생성 일시':date(draft.createdAt),
    '기록 일수':number(draft.stats.recordedDays),'식단 건수':number(draft.stats.mealCount),'강사 총평 건수':number(draft.stats.reviewCount),
    'AI 분석 초안':rich(useBody ? bodyMarker : JSON.stringify(draft.draft)),'최종 종합 총평':rich(draft.feedback),
    '긍정적 변화':rich((draft.draft?.strengths ?? []).map(item=>item.text).join('\n')),
    '개선 필요사항':rich((draft.draft?.improvements ?? []).map(item=>item.text).join('\n')),
    '다음 기간 목표':rich((draft.draft?.proposedGoals ?? []).map(item=>item.title + ' · ' + item.text).join('\n')),
    '분석 근거':rich(JSON.stringify(metadata(content))),
    '데이터 지문':rich(draft.fingerprint),'AI 모델 정보':rich(draft.model),
  },children));
}

export async function updateReport(row:ReportVersion,feedback:string,confirm:boolean) {
  const properties = {'최종 종합 총평':rich(feedback),'분석 상태':select(confirm ? '확정' : '검토중'),
    '분석 근거':rich(JSON.stringify(metadata(reportContent(row)))),
    ...(confirm ? {'확정 일시':date(new Date().toISOString())} : {})};
  return decodeReport(await notion<Page>('/pages/' + row.id,'PATCH',{properties}));
}

function decodeGoal(page: Page): Goal {
  const value = property(page,'최근 평가');
  const events = value.startsWith('[') ? parse<Goal['history']>(value) : [];
  if (!events.length && value.trim() && !value.startsWith('[')) {
    events.push({legacy:true,at:page.properties['최종 평가일']?.date?.start ?? '',status:page.properties['목표 상태']?.select?.name ?? '제안',
      approved:page.properties['강사 확정 여부']?.checkbox === true,evaluation:value,reportId:'',actor:'anonymous'});
  }
  const last = events.at(-1);
  return {id:page.id,key:property(page,'목표 ID'),title:text(page.properties['개선 목표']?.title),
    kind:page.properties['목표 유형']?.select?.name ?? '기타',criteria:property(page,'실천 기준'),
    source:property(page,'최초 근거'),status:page.properties['목표 상태']?.select?.name ?? '제안',
    approved:page.properties['강사 확정 여부']?.checkbox === true,reportId:page.properties['관련 리포트']?.relation?.[0]?.id ?? '',
    proposedAt:page.properties['최초 제안일']?.date?.start ?? '',revision:last?.revision ?? page.last_edited_time ?? '',
    evaluation:last?.evaluation ?? value,evaluatedAt:page.properties['최종 평가일']?.date?.start ?? '',history:events,
  };
}
export async function listGoals(key?: string) {
  const filter = key ? {property:'목표 ID',rich_text:{equals:key}} : undefined;
  return (await queryNotion(goals(),goalFields,filter)).map(decodeGoal);
}
export async function getGoal(id: string) { return decodeGoal(await ownedPage(goals(),id)); }
export async function createGoal(goal: Omit<Goal,'id'|'revision'|'history'|'evaluation'|'evaluatedAt'>) {
  return decodeGoal(await createPage(goals(),{
    '개선 목표':title(goal.title),'목표 ID':rich(goal.key),'목표 유형':select(goal.kind),'목표 상태':select(goal.status),
    '실천 기준':rich(goal.criteria),'최초 근거':rich(goal.source),'최초 제안일':date(goal.proposedAt),
    '강사 확정 여부':{checkbox:false},'관련 리포트':{relation:[{id:goal.reportId}]},
  }));
}
export async function updateGoal(goal: Goal, event: Goal['history'][number]) {
  return decodeGoal(await notion<Page>('/pages/' + goal.id,'PATCH',{properties:{
    '목표 상태':select(event.status),
    '최근 평가':rich(JSON.stringify([...goal.history,event])),
    ...(event.opinion === undefined ? {'최종 평가일':date(event.at)} : {}),
  }}));
}

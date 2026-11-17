import { dateBounds, timestamp } from './date';
import { HttpError, required } from './errors';
import type { Meal, Review } from './contracts';

type RichText = {plain_text: string};
type Photo = {type: string; file?: {url: string}};
export type Property = {
  id?: string; type?: string; title?: RichText[]; rich_text?: RichText[];
  date?: {start: string} | null; select?: {name: string} | null;
  checkbox?: boolean; files?: Photo[]; number?: number | null; relation?: {id:string}[]; has_more?:boolean;
  formula?: {type: string; string?: string | null; number?: number | null};
};
export type Page = {id: string; last_edited_time?: string; properties: Record<string, Property>};
type Query = {results: Page[]; next_cursor: string | null};
export const mealFields = {
  '기록명':'title', '식사 시작':'date', '식사 종료':'date', '식사 소요시간':'formula',
  '식사 구분':'select', '식단 사진':'files', '음식 내용':'rich_text', '공유 메모':'rich_text', '공유 여부':'checkbox',
};
export const reviewFields = {
  '리뷰명':'title', '리뷰 날짜':'date', '강사 총평':'rich_text', '리뷰 상태':'select', '작성 일시':'date', '수정 일시':'date',
};
export const mealSource = () => required('NOTION_MEAL_LOG_DATA_SOURCE_ID');
export const reviewSource = () => required('NOTION_DAILY_REVIEW_DATA_SOURCE_ID');
export const text = (items?: RichText[]) => items?.map(item => item.plain_text).join('') ?? '';

export class NotionError extends HttpError {
  constructor(public upstreamStatus?: number) {
    super(502, 'Notion에 연결하거나 기록을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
}

export async function notion<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const token = required('NOTION_TOKEN');
  try {
    const response = await fetch('https://api.notion.com/v1' + path, {
      method,
      headers: {Authorization: 'Bearer ' + token, 'Notion-Version': '2026-03-11', 'Content-Type': 'application/json'},
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: 'no-store', signal: AbortSignal.timeout(7000), redirect: 'error',
    });
    if (!response.ok) throw new NotionError(response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof NotionError) throw error;
    throw new NotionError();
  }
}

export async function queryNotion(source: string, fields: Record<string,string>, filter: unknown, limit = Infinity) {
  const params = new URLSearchParams();
  for (const field of Object.keys(fields)) params.append('filter_properties', field);
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const result: Query = await notion('/data_sources/' + encodeURIComponent(source) + '/query?' + params, 'POST', {
      filter, start_cursor: cursor ?? undefined, page_size: Math.min(100, limit),
    });
    pages.push(...result.results);
    cursor = result.next_cursor;
  } while (cursor && pages.length < limit);
  return pages;
}

function isSharedOn(page: Page, date: string) {
  const [from, to] = dateBounds(date).map(timestamp);
  const start = timestamp(page.properties['식사 시작']?.date?.start);
  return page.properties['공유 여부']?.checkbox === true && start >= from && start < to;
}

export function imageUrl(photo?: Photo): URL | null {
  if (photo?.type !== 'file' || !photo.file?.url) return null;
  try {
    const url = new URL(photo.file.url);
    const hosts = ['prod-files-secure.s3.us-west-2.amazonaws.com', 's3.us-west-2.amazonaws.com', 'file.notion.so'];
    if (url.protocol === 'https:' && hosts.includes(url.hostname) && !url.port && !url.username && !url.password &&
      (url.hostname !== 's3.us-west-2.amazonaws.com' || url.pathname.startsWith('/secure.notion-static.com/'))) return url;
  } catch {}
  return null;
}

export function projectMeals(pages: Page[], date: string, includeMealNote = false): Meal[] {
  return pages.filter(page => isSharedOn(page, date)).map(({id, properties: p}) => {
    const startAt = p['식사 시작'].date!.start;
    const rawEnd = p['식사 종료']?.date?.start;
    const endAt = Number.isFinite(timestamp(rawEnd)) ? rawEnd! : null;
    const minutes = endAt ? Math.floor((timestamp(endAt) - timestamp(startAt)) / 60000) : null;
    const formula = p['식사 소요시간']?.formula;
    const durationMinutes = minutes !== null && minutes >= 0 ? minutes : null;
    const displayDuration = rawEnd && (!endAt || (minutes !== null && minutes < 0)) ? '시간 확인 필요' :
      durationMinutes === null ? '' : formula?.string?.trim() || durationMinutes + '분';
    return {
      id, title: text(p['기록명']?.title), category: p['식사 구분']?.select?.name ?? '',
      startAt, endAt, durationMinutes, displayDuration, foods: text(p['음식 내용']?.rich_text),
      sharedNote: text(p['공유 메모']?.rich_text),
      ...(includeMealNote ? {mealNote:text(p['식사 메모']?.rich_text)} : {}),
      images: (p['식단 사진']?.files ?? []).flatMap((photo, index) =>
        imageUrl(photo) ? ['/api/media/' + date + '/' + encodeURIComponent(id) + '/' + index] : []),
    };
  }).sort((left, right) => timestamp(left.startAt) - timestamp(right.startAt));
}

export async function mealsFor(date: string, includeMealNote = false) {
  const [from, to] = dateBounds(date);
  const pages = await queryNotion(mealSource(), includeMealNote ? {...mealFields, '식사 메모':'rich_text'} : mealFields, {and: [
    {property:'공유 여부', checkbox:{equals:true}},
    {property:'식사 시작', date:{on_or_after:from}},
    {property:'식사 시작', date:{before:to}},
  ]});
  return projectMeals(pages, date, includeMealNote);
}

export async function photoFor(date: string, id: string, index: number) {
  const params = new URLSearchParams([
    ['filter_properties', '공유 여부'], ['filter_properties', '식사 시작'], ['filter_properties', '식단 사진'],
  ]);
  const page = await notion<Page & {parent?: {data_source_id?: string}; archived?: boolean; in_trash?: boolean}>('/pages/' + id + '?' + params);
  if (page.parent?.data_source_id !== mealSource() || page.archived || page.in_trash || !isSharedOn(page, date)) return null;
  return imageUrl(page.properties['식단 사진']?.files?.[index]);
}

export async function reviewPage(date: string) {
  const pages = await queryNotion(reviewSource(), reviewFields, {property:'리뷰 날짜', date:{equals:date}}, 2);
  if (pages.length > 1) throw new HttpError(409, '이 날짜에 총평이 중복되어 있습니다. 기록 관리자에게 문의해 주세요.');
  return pages[0];
}

export function projectReview(date: string, page?: Page): Review {
  if (!page) return {date, feedback:'', status:'missing'};
  return {date, feedback:text(page.properties['강사 총평']?.rich_text), status:'saved',
    updatedAt:page.properties['수정 일시']?.date?.start};
}

export async function writeReview(date: string, feedback: string, existing?: Page) {
  const chars = Array.from(feedback);
  const segments = [];
  // Keep each segment under Notion's UTF-16 or Unicode character limits.
  for (let i = 0; i < chars.length; i += 1000) {
    segments.push({type:'text', text:{content:chars.slice(i, i + 1000).join('')}});
  }
  const now = new Date().toISOString();
  const properties = {
    '강사 총평': {rich_text: segments}, '수정 일시': {date:{start:now}}, '리뷰 상태': {select:{name:'완료'}},
  };
  const page = existing
    ? await notion<Page>('/pages/' + existing.id, 'PATCH', {properties})
    : await notion<Page>('/pages', 'POST', {parent:{type:'data_source_id', data_source_id:reviewSource()}, properties:{
      ...properties, '리뷰명':{title:[{type:'text', text:{content:date + ' 식단 리뷰'}}]},
      '리뷰 날짜':{date:{start:date}}, '작성 일시':{date:{start:now}},
    }});
  return projectReview(date, page);
}

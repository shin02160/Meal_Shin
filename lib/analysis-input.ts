import { digest } from './auth';
import { timestamp } from './date';
import { mealFields, mealSource, projectMeals, queryNotion, reviewFields, reviewSource, text } from './notion';
import { kstDate, periodKey, type Period } from './period';

export async function collectPeriod(period: Pick<Period, 'start' | 'until'>) {
  const dateFilter = (property: string, start: string, until: string) => [
    {property, date:{on_or_after:start}}, {property, date:{before:until}},
  ];
  const {['식단 사진']: _photos, ...analysisFields} = mealFields;
  void _photos;
  const [rows, reviews] = await Promise.all([
    queryNotion(mealSource(), analysisFields, {and:[
      {property:'공유 여부', checkbox:{equals:true}},
      ...dateFilter('식사 시작', period.start + 'T00:00:00+09:00', period.until + 'T00:00:00+09:00'),
    ]}),
    queryNotion(reviewSource(), reviewFields, {and:[
      {property:'리뷰 상태', select:{equals:'완료'}}, ...dateFilter('리뷰 날짜', period.start, period.until),
    ]}),
  ]);
  const meals = rows.flatMap(row => {
    const start = timestamp(row.properties['식사 시작']?.date?.start);
    if (!Number.isFinite(start)) return [];
    const date = kstDate(start);
    if (date < period.start || date >= period.until) return [];
    return projectMeals([row], date).map(meal => ({
      id:meal.id, date, updatedAt:row.last_edited_time ?? '', title:meal.title,
      category:meal.category, start:meal.startAt, end:meal.endAt, duration:meal.durationMinutes,
      foods:meal.foods, sharedNote:meal.sharedNote,
    }));
  }).sort((a,b) => a.date.localeCompare(b.date) || timestamp(a.start)-timestamp(b.start) || a.id.localeCompare(b.id));
  const days = new Set(meals.map(meal => meal.date));
  const daily = reviews.flatMap(row => {
    const date = row.properties['리뷰 날짜']?.date?.start ?? '';
    const feedback = text(row.properties['강사 총평']?.rich_text).trim();
    return days.has(date) && row.properties['리뷰 상태']?.select?.name === '완료' && feedback ?
      [{id:row.id, date, updatedAt:row.properties['수정 일시']?.date?.start ?? row.last_edited_time ?? '', feedback}] : [];
  }).sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const starts: Record<string, Record<string, number>> = {};
  const weeks: Record<string, {days:Set<string>; meals:number}> = {};
  const durations: number[] = [];
  for (const meal of meals) {
    const category = meal.category || '미분류';
    const hour = String(new Date(timestamp(meal.start) + 32400000).getUTCHours()).padStart(2,'0') + ':00';
    (starts[category] ??= {})[hour] = (starts[category][hour] ?? 0) + 1;
    if (meal.duration !== null) durations.push(meal.duration);
    const week = weeks[periodKey('weekly', meal.date)] ??= {days:new Set(),meals:0};
    week.days.add(meal.date);
    week.meals++;
  }
  const stats = {
    recordedDays:days.size, mealCount:meals.length, reviewCount:daily.length, starts,
    durations:{count:durations.length,min:durations.length ? Math.min(...durations) : null,
      max:durations.length ? Math.max(...durations) : null,
      average:durations.length ? Math.round(durations.reduce((a,b)=>a+b,0)/durations.length*10)/10 : null},
    weeks:Object.entries(weeks).map(([key,week]) => ({key, recordedDays:week.days.size, mealCount:week.meals})),
    limitations:['기록이 없는 날의 식사 여부는 알 수 없습니다.',
      '시작 시각이 없는 기록은 기간을 확인할 수 없어 제외합니다.',
      '음료 기록도 기록 일수에 포함되며 완전한 식사를 뜻하지 않습니다.',
      ...(meals.length > durations.length ? ['종료 시각이 없거나 유효하지 않은 기록은 소요시간 집계에서 제외했습니다.'] : []),
      ...(days.size < 3 ? ['기록이 적어 기간 전체의 경향을 판단하기 어렵습니다.'] : [])],
  };
  const refs = [
    ...meals.map(({id,date,updatedAt}) => ({id,date,updatedAt,kind:'meal' as const})),
    ...daily.map(({id,date,updatedAt}) => ({id,date,updatedAt,kind:'daily' as const})),
  ];
  const fingerprint = digest(JSON.stringify({meals:meals.map(({updatedAt,...meal}) => {void updatedAt; return meal;}), daily}));
  return {meals,daily,stats,refs,fingerprint};
}
export type PeriodInput = Awaited<ReturnType<typeof collectPeriod>>;

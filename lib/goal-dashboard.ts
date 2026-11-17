import { isDate, shiftDate } from './date';
import { kstDate, periodFor, periodKey } from './period';
import type { Goal, GoalEvent } from './report-contracts';
import type { GoalProgressSummary, Progress } from './progress-contracts';

export const dashboardRanges = ['week', 'month', 'quarter'] as const;
export type DashboardRange = typeof dashboardRanges[number];
type DateRange = { start: string; until: string };

export function dashboardPeriods(range: DashboardRange, today: string) {
  const weeks = Array.from({ length: 6 }, (_, index) =>
    periodFor('weekly', periodKey('weekly', shiftDate(today, (index - 5) * 7))));
  const months = Array.from({ length: 3 }, (_, index) => {
    const month = new Date(today.slice(0, 7) + '-01T00:00:00Z');
    month.setUTCMonth(month.getUTCMonth() + index - 2);
    return periodFor('monthly', month.toISOString().slice(0, 7));
  });
  const week = weeks[weeks.length - 1];
  const month = months[months.length - 1];
  const end = shiftDate(today, 1);
  const selection = {
    start: range === 'week' ? week.start : range === 'month' ? month.start : months[0].start,
    until: end,
  };

  return {
    selection,
    sourceRange: { start: [weeks[0].start, months[0].start].sort()[0], until: end },
    weeks,
    months,
  };
}

export function assessmentTotals(records: readonly Pick<Progress, 'status'>[]) {
  const counts = { achieved: 0, partial: 0, missed: 0, unknown: 0 };
  for (const { status } of records) {
    if (status === '달성') counts.achieved++;
    else if (status === '부분달성') counts.partial++;
    else if (status === '미달성') counts.missed++;
    else counts.unknown++;
  }
  const evaluated = counts.achieved + counts.partial + counts.missed;
  return { ...counts, evaluated, rate: evaluated ? Math.round(1000 * counts.achieved / evaluated) / 10 : null };
}

function localDay(value: string) {
  if (isDate(value)) return value;
  const time = Date.parse(value);
  return Number.isFinite(time) ? kstDate(time) : '';
}

export function unrecordedDays(goal: Pick<Goal, 'proposedAt' | 'status' | 'history'>, range: DateRange, recorded: ReadonlySet<string>) {
  const start = localDay(goal.proposedAt);
  if (!start) return null;
  if (start >= range.until) return 0;
  const events = goal.history.filter(event => event.opinion === undefined);
  if (events.some(event => event.legacy || !localDay(event.at) || localDay(event.at) < start)) return null;
  const states = events.map(event => ({ day: localDay(event.at), status: event.status }))
    .sort((left, right) => left.day.localeCompare(right.day));
  if (!hasKnownBeginning(goal.status, events) || (states.at(-1)?.status ?? '제안') !== goal.status) return null;

  let missing = 0;
  let status = '제안';
  let index = 0;
  for (let day = range.start > start ? range.start : start; day < range.until; day = shiftDate(day, 1)) {
    while (index < states.length && states[index].day <= day) status = states[index++].status;
    if ((status === '진행중' || status === '유지') && !recorded.has(day)) missing++;
  }
  return missing;
}

function hasKnownBeginning(status: string, events: GoalEvent[]) {
  // Goals created by the app begin as 제안. A legacy active goal has no
  // reliable active start until its history documents an activation.
  return events[0]?.status === '진행중' || (!events.length && status === '제안');
}

type Totals = ReturnType<typeof assessmentTotals>;
export type DashboardPoint = Totals & { key: string; start: string; end: string; unrecorded: number | null };
export type GoalDashboard = {
  asOf: string;
  start: string;
  end: string;
  managed: number;
  proposed: number;
  unrecorded: number | null;
  totals: Totals;
  entries: { goalId: string; totals: Totals; latest: GoalProgressSummary['latest'] }[];
  weeks: DashboardPoint[];
  months: DashboardPoint[];
};

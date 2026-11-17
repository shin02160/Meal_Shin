import { shiftDate } from './date';
import { periodFor, periodKey } from './period';
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

export function unrecordedDays(range: DateRange, recorded: ReadonlySet<string>) {
  let missing = 0;
  for (let day = range.start; day < range.until; day = shiftDate(day, 1)) {
    if (!recorded.has(day)) missing++;
  }
  return missing;
}

type Totals = ReturnType<typeof assessmentTotals>;
export type DashboardPoint = Totals & { key: string; start: string; end: string; unrecorded: number };
export type GoalDashboard = {
  asOf: string;
  start: string;
  end: string;
  managed: number;
  proposed: number;
  unrecorded: number;
  totals: Totals;
  entries: { goalId: string; totals: Totals; latest: GoalProgressSummary['latest'] }[];
  weeks: DashboardPoint[];
  months: DashboardPoint[];
};

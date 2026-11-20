import { isDate, shiftDate } from './date';
import type { Period } from './period';

export function importedReportScope(period: Pick<Period, 'start' | 'until'>, evidence: string) {
  const normalized = evidence.replace(/\\(?=[~～])/g, '');
  const ranges = [...normalized.matchAll(/(\d{4}-\d{2}-\d{2})\s*[~～]\s*((?:\d{4}-)?\d{2}-\d{2})(?!\d)/g)];
  if (!ranges.length) return period;
  const dates = ranges.map(([, start, end]) => ({
    start,
    end: end.length === 5 ? start.slice(0, 5) + end : end,
  }));
  if (dates.some(({ start, end }) => !isDate(start) || !isDate(end) ||
      start > end || start < period.start || end >= period.until)) return period;
  return {
    start: dates.map(range => range.start).sort()[0],
    until: shiftDate(dates.map(range => range.end).sort().at(-1)!, 1),
  };
}

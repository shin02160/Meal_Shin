import { HttpError } from './errors';
import { isDate, shiftDate } from './date';

export type PeriodType = 'weekly' | 'monthly';
export type Period = {type:PeriodType; key:string; start:string; end:string; until:string};

function monday(date: string) {
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}
export function periodFor(type: unknown, key: unknown): Period {
  const invalid = () => new HttpError(400, '올바른 주간 또는 월간을 선택해 주세요.');
  if (typeof key !== 'string' || !/^\d{4}-(?:W\d{2}|\d{2})$/.test(key)) throw invalid();
  const year = Number(key.slice(0,4));
  if (year < 1900 || year > 9998) throw invalid();
  let start: string;
  let until: string;
  if (type === 'weekly' && key[5] === 'W') {
    const week = Number(key.slice(6));
    start = shiftDate(monday(key.slice(0,4) + '-01-04'), 7 * (week - 1));
    until = shiftDate(start, 7);
    if (week < 1 || week > 53 || shiftDate(start, 3).slice(0,4) !== key.slice(0,4)) throw invalid();
  } else if (type === 'monthly' && isDate(key + '-01')) {
    start = key + '-01';
    until = shiftDate(start, 32).slice(0,7) + '-01';
  } else {
    throw invalid();
  }
  return {type, key, start, end:shiftDate(until, -1), until};
}

export function periodKey(type: PeriodType, date: string) {
  if (type === 'monthly') return date.slice(0,7);
  const first = monday(date);
  const year = shiftDate(first, 3).slice(0,4);
  const day = (value: string) => Date.parse(value + 'T00:00:00Z');
  const week = (day(first) - day(monday(year + '-01-04'))) / 604800000 + 1;
  return year + '-W' + String(week).padStart(2,'0');
}

export function kstDate(millis: number) {
  return new Date(millis + 32400000).toISOString().slice(0,10);
}

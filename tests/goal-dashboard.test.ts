import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessmentTotals, dashboardPeriods, unrecordedDays } from '../lib/goal-dashboard';

test('dashboard uses current Korean calendar week and calendar months through today', () => {
  assert.deepEqual(dashboardPeriods('week','2026-01-01').selection,{start:'2025-12-29',until:'2026-01-02'});
  assert.deepEqual(dashboardPeriods('month','2026-01-01').selection,{start:'2026-01-01',until:'2026-01-02'});
  const quarter = dashboardPeriods('quarter','2026-01-16');
  assert.deepEqual(quarter.selection,{start:'2025-11-01',until:'2026-01-17'});
  assert.deepEqual(quarter.months.map(month=>month.key),['2025-11','2025-12','2026-01']);
  assert.equal(quarter.weeks.length,6);
});

test('dashboard counts achieved, partial and missed in denominator, excluding unknown', () => {
  assert.deepEqual(assessmentTotals([{status:'달성'},{status:'부분달성'},{status:'미달성'},{status:'판단불가'}]),
    {achieved:1,partial:1,missed:1,unknown:1,evaluated:3,rate:33.3});
  assert.equal(assessmentTotals([{status:'판단불가'}]).rate,null);
  assert.equal(assessmentTotals([]).rate,null);
});

test('missing dates use the full selected range through today', () => {
  const range = dashboardPeriods('week','2026-11-18').selection;
  assert.equal(unrecordedDays(range,new Set(['2026-11-16','2026-11-18','2026-11-19'])),1);
  assert.equal(unrecordedDays(range,new Set()),3);
});

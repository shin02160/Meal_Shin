import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessmentTotals, dashboardPeriods, unrecordedDays } from '../lib/goal-dashboard';
import type { GoalEvent } from '../lib/report-contracts';

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

test('missing dates exclude proposed, suspended, ended and future dates', () => {
  const event = (at:string,status:string):GoalEvent => ({at,status,approved:false,evaluation:'',reportId:'',actor:'anonymous'});
  const history = [event('2026-11-02T15:30:00Z','진행중'),event('2026-11-05','보류'),event('2026-11-07','유지'),event('2026-11-09','종료')];
  const range = {start:'2026-11-01',until:'2026-11-11'};
  const goal = {proposedAt:'2026-11-02',status:'종료',history};
  assert.equal(unrecordedDays(goal,range,new Set(['2026-11-03','2026-11-08'])),2);
  assert.equal(unrecordedDays({...goal,proposedAt:''},range,new Set()),null);
  assert.equal(unrecordedDays({...goal,status:'진행중',history:[]},range,new Set()),null);
  assert.equal(unrecordedDays({...goal,history:[{...history[0],legacy:true}]},range,new Set()),null);
  assert.equal(unrecordedDays({...goal,proposedAt:'2026-11-12'},range,new Set()),0);
});

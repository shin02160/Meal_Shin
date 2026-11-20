import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importedReportScope } from '../lib/imported-report-scope';

const month = {start:'2026-11-01',until:'2026-12-01'};

test('monthly imported report uses explicitly dated weekly evidence without widening to the whole month', () => {
  assert.deepEqual(importedReportScope(month,'주간 분석 2026-11-16~11-22 기반'),{start:'2026-11-16',until:'2026-11-23'});
  assert.deepEqual(importedReportScope(month,'주간 분석 2026-11-16\\~11-22 기반'),{start:'2026-11-16',until:'2026-11-23'});
  assert.deepEqual(importedReportScope(month,'2026-11-16 ～ 2026-11-20'),{start:'2026-11-16',until:'2026-11-21'});
});

test('missing, invalid or out-of-period evidence retains full period visibility checks', () => {
  for(const evidence of ['샘플 근거','2026-11-30~11-20','2026-11-01~11-31','2026-10-16~11-20']) {
    assert.deepEqual(importedReportScope(month,evidence),month);
  }
  assert.deepEqual(importedReportScope(month,'2026-11-16~11-18 및 2026-11-20~11-22'),{start:'2026-11-16',until:'2026-11-23'});
});

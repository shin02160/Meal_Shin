import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecentGoalAssessment } from '../app/review/[view]/recent-goal-assessment';
import type { ProgressState } from '../lib/progress-contracts';

const assessmentDay = '2026-11-16';
const states = [
  ['달성', 'success', '✓'],
  ['부분달성', 'warning', '◉'],
  ['미달성', 'danger', '✕'],
  ['판단불가', 'neutral', '?'],
] as const;

for (const [status, tone, icon] of states) {
  test('recent assessment shows its date and badge for ' + status, () => {
    const html = renderToStaticMarkup(createElement(RecentGoalAssessment, {
      assessment: { day: assessmentDay, status, confirmed: false },
    }));
    assert.ok(html.includes('<time dateTime="2026-11-16">2026.11.16</time>'));
    assert.ok(html.includes('goal-assessment-badge--' + tone + '">'));
    assert.ok(html.includes('<span aria-hidden="true">' + icon + '</span>' + status + '</span>'));
  });
}

test('missing assessment has a muted badge and no date', () => {
  for (const assessment of [null, undefined]) {
    const html = renderToStaticMarkup(createElement(RecentGoalAssessment, { assessment }));
    assert.match(html, /최근 평가 없음/);
    assert.match(html, /goal-assessment-badge--muted/);
    assert.match(html, /aria-hidden="true">−<\/span>미기록/);
    assert.doesNotMatch(html, /<time/);
  }
});

test('unexpected API status has a neutral badge and keeps its date', () => {
  const html = renderToStaticMarkup(createElement(RecentGoalAssessment, {
    assessment: { day: assessmentDay, status: 'toString' as ProgressState, confirmed: true },
  }));
  assert.match(html, /goal-assessment-badge--neutral/);
  assert.match(html, /알 수 없음/);
  assert.match(html, /2026\.11\.16/);
  assert.doesNotMatch(html, /미달성|미기록/);
});

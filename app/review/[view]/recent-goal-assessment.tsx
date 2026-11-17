import type { GoalProgressSummary, ProgressState } from '../../../lib/progress-contracts';

const assessmentBadges = {
  '달성': { tone: 'success', icon: '✓' },
  '부분달성': { tone: 'warning', icon: '◉' },
  '미달성': { tone: 'danger', icon: '✕' },
  '판단불가': { tone: 'neutral', icon: '?' },
} satisfies Record<ProgressState, { tone: string; icon: string }>;

export function RecentGoalAssessment({ assessment }: { assessment: GoalProgressSummary['latest'] }) {
  const status = assessment?.status;
  const knownStatus = status != null && Object.hasOwn(assessmentBadges, status);
  const label = knownStatus ? status : assessment ? '알 수 없음' : '미기록';
  const badge = knownStatus ? assessmentBadges[status] : assessment
    ? { tone: 'neutral', icon: '?' }
    : { tone: 'muted', icon: '−' };

  return (
    <p className="goal-recent-assessment">
      <span>
        {assessment
          ? <>최근 평가 · <time dateTime={assessment.day}>{assessment.day.replaceAll('-', '.')}</time></>
          : '최근 평가 없음'}
      </span>
      <span className={'goal-assessment-badge goal-assessment-badge--' + badge.tone}>
        <span aria-hidden="true">{badge.icon}</span>
        {label}
      </span>
    </p>
  );
}

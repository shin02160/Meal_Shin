import type { DashboardPoint, GoalDashboard } from '../../../lib/goal-dashboard';

const pct = (rate: number | null) => rate === null ? '—' : rate + '%';

export function GoalDashboardSummary({ data }: { data: GoalDashboard }) {
  const { totals } = data;
  return <section className="panel" aria-label="개선 목표 요약">
    <p>집계 기간 {data.start} ~ {data.end} · 한국 시간</p>
    <dl className="report-metrics">
      <div><dt>관리 중인 목표</dt><dd>{data.managed}개</dd></div>
      <div><dt>평가 완료</dt><dd>{totals.evaluated}건</dd></div>
      <div><dt>달성률</dt><dd>{pct(totals.rate)}</dd></div>
      <div><dt>미기록</dt><dd>{data.unrecorded}건</dd></div>
    </dl>
    <p>제안 {data.proposed}개 · 달성 {totals.achieved} · 부분달성 {totals.partial} · 미달성 {totals.missed} · 판단불가 {totals.unknown}</p>
    {totals.rate === null && <p>선택 기간에 달성률을 계산할 평가 데이터가 없습니다.</p>}
    <p>미기록은 진행중·유지 목표의 집계 기간 중 평가가 없는 날을 합산합니다.</p>
  </section>;
}

function Trend({ title, points }: { title: string; points: DashboardPoint[] }) {
  if (!points.some(point => point.evaluated > 0 || point.unknown > 0)) return <p>{title}에 표시할 평가 데이터가 없습니다.</p>;
  return <section>
    <h3>{title}</h3>
    <ul className="goal-trend">
      {points.map(point => <li key={point.key}>
        <strong>{point.start.slice(5)} ~ {point.end.slice(5)}</strong>
        {point.rate !== null && <span aria-hidden="true" className="goal-trend-bar"><span style={{ width: point.rate + '%' }}/></span>}
        <span>{pct(point.rate)} · 평가 {point.evaluated}건 · 판단불가 {point.unknown}건 · 미기록 {point.unrecorded}건</span>
      </li>)}
    </ul>
  </section>;
}

export function GoalDashboardTrends({ data }: { data: GoalDashboard }) {
  return <section className="panel">
    <h2>최근 변화</h2>
    <Trend title="최근 6주" points={data.weeks}/>
    <Trend title="최근 3개월" points={data.months}/>
  </section>;
}

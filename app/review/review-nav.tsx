import Link from 'next/link';

export function ReviewNav({active}: {active:'daily'|'weekly'|'monthly'|'goals'}) {
  const links = [
    ['daily','/review','일별'], ['weekly','/review/weekly','주간'],
    ['monthly','/review/monthly','월간'], ['goals','/review/goals','개선 목표'],
  ];
  return <nav className="review-nav" aria-label="리뷰 메뉴">
    {links.map(([key,href,label]) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined}>{label}</Link>)}
  </nav>;
}

import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { todayKst } from '../../../lib/date';
import { periodKey } from '../../../lib/period';
import { isPublicHost } from '../../../lib/public-host';
import { ReviewNav } from '../review-nav';
import { PeriodScreen } from './period-screen';
import { GoalsScreen } from './goals-screen';

export const dynamic = 'force-dynamic';
export default async function Page({params}:{params:Promise<{view:string}>}) {
  const {view} = await params;
  if (view !== 'weekly' && view !== 'monthly' && view !== 'goals') notFound();
  if (!isPublicHost((await headers()).get('host') ?? '')) redirect('/review');
  const today = todayKst();
  return <main>
    <header><span className="brand">MEAL NOTE</span><h1>{view === 'goals' ? '개선 목표' : view === 'weekly' ? '주간 식단 리뷰' : '월간 식단 리뷰'}</h1></header>
    <ReviewNav active={view}/>
    {view === 'goals' ? <GoalsScreen today={today}/> : <PeriodScreen type={view} initialKey={periodKey(view,today)}/>}
  </main>;
}

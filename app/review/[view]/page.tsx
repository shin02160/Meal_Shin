import { authenticate, publicOrigin } from '../../../lib/auth';
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
  const requestHeaders = await headers();
  if (!isPublicHost(requestHeaders.get('host') ?? '')) redirect('/review');
  try {
    await authenticate(new Request(publicOrigin,{headers:{cookie:requestHeaders.get('cookie') ?? ''}}));
  } catch {
    redirect('/review?next=' + view);
  }
  const today = todayKst();
  return <main>
    <header><span className="brand">MEAL NOTE</span><h1>{view === 'goals' ? '개선 목표' : view === 'weekly' ? '주간 식단 리뷰' : '월간 식단 리뷰'}</h1></header>
    <ReviewNav active={view}/>
    {view === 'goals' ? <GoalsScreen today={today}/> : <PeriodScreen type={view} initialKey={periodKey(view,today)}/>}
  </main>;
}

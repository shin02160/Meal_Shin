import { headers } from 'next/headers';
import { isPublicHost } from '../../lib/public-host';
import { ReviewScreen } from './review-screen';
import { isDate, todayKst } from '../../lib/date';

export const dynamic = 'force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{date?:string;next?:string}>}) {
  const {date,next} = await searchParams;
  return <ReviewScreen key={typeof date === 'string' ? date : ''} initialDate={typeof date === 'string' && isDate(date) && date !== '9999-12-31' ? date : todayKst()} nextView={next === 'weekly' || next === 'monthly' || next === 'goals' ? next : undefined} publicAccess={isPublicHost((await headers()).get('host') ?? '')}/>;
}

import { headers } from 'next/headers';
import { isPublicHost } from '../../lib/public-host';
import { ReviewScreen } from './review-screen';
import { isDate, todayKst } from '../../lib/date';

export const dynamic = 'force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{date?:string}>}) {
  const {date} = await searchParams;
  return <ReviewScreen key={typeof date === 'string' ? date : ''} initialDate={typeof date === 'string' && isDate(date) && date !== '9999-12-31' ? date : todayKst()} publicAccess={isPublicHost((await headers()).get('host') ?? '')}/>;
}

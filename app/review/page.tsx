import { headers } from 'next/headers';
import { isPublicHost } from '../../lib/public-host';
import { ReviewScreen } from './review-screen';
import { todayKst } from '../../lib/date';

export const dynamic = 'force-dynamic';
export default async function Page() {
  return <ReviewScreen initialDate={todayKst()} publicAccess={isPublicHost((await headers()).get('host') ?? '')}/>;
}

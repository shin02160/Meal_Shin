import { headers } from 'next/headers';
import { isOwnerHost } from '../../lib/owner-host';
import { ReviewScreen } from './review-screen';
import { todayKst } from '../../lib/date';

export const dynamic = 'force-dynamic';
export default async function Page() {
  return <ReviewScreen initialDate={todayKst()} owner={isOwnerHost((await headers()).get('host') ?? '')}/>;
}

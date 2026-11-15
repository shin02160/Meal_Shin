import { ReviewScreen } from './review-screen';
import { todayKst } from '../../lib/date';

export const dynamic = 'force-dynamic';
export default function Page() {
  return <ReviewScreen initialDate={todayKst()}/>;
}

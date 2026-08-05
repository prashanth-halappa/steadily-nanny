/**
 * @module app/(private)/settings/pay/[carerId]
 *
 * Route: `/settings/pay/{carerId}` — the explicit second-nanny case reached
 * from the picker on `/settings/pay`. Same component as the index route;
 * `PayArrangementScreen` reads `carerId` from the route itself.
 */
import { PayArrangementScreen } from '@/src/domains/pay/components/PayArrangementScreen';

export default function PayArrangementForCarerRoute() {
  return <PayArrangementScreen />;
}

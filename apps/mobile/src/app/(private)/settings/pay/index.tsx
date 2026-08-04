/**
 * @module app/(private)/settings/pay/index
 *
 * Route: `/settings/pay`. Reached from the Settings tab (parent only,
 * `testID="settings-pay"`). See
 * `src/domains/pay/components/PayArrangementScreen` for the implementation —
 * it resolves the carer from the household when there is exactly one nanny,
 * or shows a picker when there are more.
 */
import { PayArrangementScreen } from '@/src/domains/pay/components/PayArrangementScreen';

export default function PayArrangementRoute() {
  return <PayArrangementScreen />;
}

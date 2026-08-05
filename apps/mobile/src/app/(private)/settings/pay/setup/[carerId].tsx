/**
 * @module app/(private)/settings/pay/setup/[carerId]
 *
 * Route: `/settings/pay/setup/{carerId}`. Reached from the prompt card on
 * Manage household and every no-arrangement empty state in the pay domain.
 * See `src/domains/pay/components/PaySetupScreen` for the implementation.
 */
import { PaySetupScreen } from '@/src/domains/pay/components/PaySetupScreen';

export default function PaySetupRoute() {
  return <PaySetupScreen />;
}

/**
 * @module app/(private)/settings/my-pay
 *
 * Route: `/settings/my-pay`. Reached from the Settings tab (nanny only,
 * `testID="settings-my-pay"`). See `src/domains/pay/components/MyPayScreen`
 * for the implementation.
 */
import { MyPayScreen } from '@/src/domains/pay/components/MyPayScreen';

export default function MyPayRoute() {
  return <MyPayScreen />;
}

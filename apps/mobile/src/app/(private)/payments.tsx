/**
 * @module app/(private)/payments
 *
 * Route: `/payments`. Pushed from Hours — a sibling of `(tabs)`, so it covers
 * the tab bar. See `src/domains/timesheet/components/PaymentsScreen` for the
 * real implementation.
 */
import { PaymentsScreen } from '@/src/domains/timesheet/components/PaymentsScreen';

export default function PaymentsRoute() {
  return <PaymentsScreen />;
}

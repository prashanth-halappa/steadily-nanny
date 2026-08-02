/**
 * @module app/(private)/settings/availability
 *
 * Route: `/settings/availability`. Reached from the Settings tab (nanny
 * only). See `src/domains/setup/components/ManageAvailabilityScreen` for
 * the real implementation.
 */
import { ManageAvailabilityScreen } from '@/src/domains/setup/components/ManageAvailabilityScreen';

export default function ManageAvailabilityRoute() {
  return <ManageAvailabilityScreen />;
}

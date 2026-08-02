/**
 * @module app/(private)/settings/household
 *
 * Route: `/settings/household`. Reached from the Settings tab (parent only).
 * See `src/domains/setup/components/ManageHouseholdScreen` for the real
 * implementation.
 */
import { ManageHouseholdScreen } from '@/src/domains/setup/components/ManageHouseholdScreen';

export default function ManageHouseholdRoute() {
  return <ManageHouseholdScreen />;
}

/**
 * @module app/(private)/settings/carer/[carerId]
 *
 * Route: `/settings/carer/{carerId}` (parent only) — reached from a
 * pressable row in `ManageHouseholdScreen`'s member list. See
 * `src/domains/household/components/CarerProfileScreen` for the
 * implementation.
 */
import { CarerProfileScreen } from '@/src/domains/household/components/CarerProfileScreen';

export default function CarerProfileRoute() {
  return <CarerProfileScreen />;
}

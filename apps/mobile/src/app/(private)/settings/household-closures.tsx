/**
 * @module app/(private)/settings/household-closures
 *
 * Route: `/settings/household-closures`. Reached from the Settings tab
 * (parent only). See `src/domains/householdClosures/components/HouseholdClosuresScreen`
 * for the implementation.
 */
import { HouseholdClosuresScreen } from '@/src/domains/householdClosures/components/HouseholdClosuresScreen';

export default function HouseholdClosuresRoute() {
  return <HouseholdClosuresScreen />;
}

/**
 * @module app/(private)/settings/household-holidays
 *
 * Route: `/settings/household-holidays`. Reached from the Settings tab.
 * See `src/domains/household/components/HouseholdHolidaysScreen`
 * for the implementation.
 */
import { HouseholdHolidaysScreen } from '@/src/domains/household/components/HouseholdHolidaysScreen';

export default function HouseholdHolidaysRoute() {
  return <HouseholdHolidaysScreen />;
}

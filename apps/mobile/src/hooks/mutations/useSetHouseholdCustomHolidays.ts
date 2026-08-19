/**
 * @module hooks/mutations/useSetHouseholdCustomHolidays
 *
 * Replaces the household's custom days (`PUT .../custom-holidays`).
 * Owner/parent only — enforced server-side. Writes the returned rows
 * straight into the custom-holidays query cache so the settings
 * screen does not flash a stale list while a refetch would round-trip.
 * An empty payload is how the last custom day is deleted.
 */
import type {
  HouseholdCustomHoliday,
  SetHouseholdCustomHolidaysRequest,
} from '@steadily-nanny/shared-types/schemas/householdHoliday.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useSetHouseholdCustomHolidays(householdId: string) {
  const { t } = useTranslation('errors');
  const queryClient = useQueryClient();

  return useMutation<
    HouseholdCustomHoliday[],
    Error,
    SetHouseholdCustomHolidaysRequest
  >({
    mutationFn: input => householdApi.setCustomHolidays(householdId, input),
    onSuccess: rows => {
      queryClient.setQueryData(
        queryKeys.household.customHolidays(householdId),
        rows
      );
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}

/**
 * @module hooks/mutations/useSetHouseholdHolidays
 *
 * Upserts a set of holiday toggles (`PUT .../holidays`). Owner/parent
 * only — enforced server-side. Writes the returned rows straight into
 * the holidays query cache so the terms screen does not flash stale
 * toggles while a refetch would round-trip.
 */
import type {
  HouseholdHoliday,
  SetHouseholdHolidaysRequest,
} from '@steadily-nanny/shared-types/schemas/householdHoliday.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useSetHouseholdHolidays(householdId: string) {
  const { t } = useTranslation('errors');
  const queryClient = useQueryClient();

  return useMutation<HouseholdHoliday[], Error, SetHouseholdHolidaysRequest>({
    mutationFn: input => householdApi.setHolidays(householdId, input),
    onSuccess: rows => {
      queryClient.setQueryData(queryKeys.household.holidays(householdId), rows);
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}

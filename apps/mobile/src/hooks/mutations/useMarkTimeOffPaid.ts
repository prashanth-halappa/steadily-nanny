/** @module hooks/mutations/useMarkTimeOffPaid — mark (or correct) paid minutes on one carer's time off. Parents only. */
import type {
  MarkTimeOffPaidRequest,
  PtoLedgerEntry,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ptoApi } from '@/src/api/endpoints/pto';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Marks `minutes` of `time_off_id` as paid — or, when the append-only
 * unique index already has a usage row for this time off, appends a
 * correcting `adjustment` row instead (TIER0-PLAN.md Phase 3; the sheet
 * copy calls this "Adjust", never "Edit" — the ledger is never mutated in
 * place). A non-parent gets a 403 server-side.
 *
 * On success, invalidates the balance AND ledger caches for this
 * (household, carer, year) — a new ledger row changes both — AND the
 * household's time-off list, since `household-time-off.tsx`'s paid marker
 * ("8h paid" / "Not marked paid") reads from that list, not the ledger
 * directly (TIER0-CX-SPEC.md §5.1).
 */
export function useMarkTimeOffPaid(
  householdId: string,
  carerId: string,
  year: number
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<PtoLedgerEntry, Error, MarkTimeOffPaidRequest>({
    mutationFn: input => ptoApi.markPaid(householdId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.pto.balance(householdId, carerId, year),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pto.ledger(householdId, carerId, year),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.timeOff.forHousehold(householdId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}

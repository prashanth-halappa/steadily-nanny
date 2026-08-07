/**
 * @module hooks/mutations/useRespondToApproval
 *
 * Approve or decline a co-parent approval from the inbox. Responding is not
 * a local status flip — the server applies (approved) or rejects (declined)
 * the underlying scheduling action that opened the approval
 * (short-notice change / cancel / extra shift), so a success has to
 * invalidate everything that action can have touched:
 *
 *  - `queryKeys.inbox.approvals(householdId)` — the responded row must
 *    disappear from GET /approvals immediately, same household only.
 *  - `queryKeys.shift.all` — an approved change/cancel/extra-shift mutates a
 *    shift row.
 *  - `queryKeys.schedulePattern.all` — the approval gate also wraps
 *    pattern-driven schedule changes (see `approvalGateService`).
 *  - `queryKeys.me.all` — the me fan-in endpoints (shifts, change requests)
 *    must reflect the applied action for the current user right away.
 *
 * Same broad-invalidate spirit as `useRespondToShiftChangeRequest`.
 */
import type { RespondToCoParentApprovalInput } from '@steadily-nanny/shared-types/schemas/approval.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/src/api/queryKeys';
import { respondToApproval } from '@/src/domains/inbox/api';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

interface RespondToApprovalVariables {
  householdId: string;
  approvalId: string;
  status: RespondToCoParentApprovalInput['status'];
}

export function useRespondToApproval() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'inbox']);

  return useMutation({
    mutationFn: ({
      householdId,
      approvalId,
      status,
    }: RespondToApprovalVariables) =>
      respondToApproval(householdId, approvalId, status),
    onSuccess: (_approval, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inbox.approvals(variables.householdId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      showSuccessToast(t('inbox:items.approval.respondedToast'));
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}

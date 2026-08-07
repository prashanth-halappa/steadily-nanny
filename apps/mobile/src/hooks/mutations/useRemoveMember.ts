/**
 * @module hooks/mutations/useRemoveMember
 *
 * Soft-removes a household member (`PATCH .../members/:memberId`,
 * `status: 'removed'`). Owner/parent only — enforced server-side; the
 * component decides who sees the "Remove" action at all.
 *
 * The one 409 this endpoint can throw is the member being clocked in
 * (`MemberHasRunningEntryError` — see `householdCommandService.removeMember`).
 * The generic "conflicts with the current state" toast doesn't tell a parent
 * what to actually do, so it's mapped to a specific message — same pattern
 * as `useUpdateTimeEntry`'s `getTimeEntryEditErrorKey`.
 */
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface ErrorLike {
  response?: {
    status?: number;
    data?: { error?: { metadata?: { reason?: string } } };
  };
}

function getRemoveMemberErrorKey(error: unknown): string | undefined {
  const err = (error ?? {}) as ErrorLike;
  if (
    err.response?.status === 409 &&
    err.response.data?.error?.metadata?.reason === 'MEMBER_HAS_RUNNING_ENTRY'
  ) {
    return 'errors:memberHasRunningEntry';
  }
  return undefined;
}

export function useRemoveMember(householdId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<HouseholdMember, Error, string>({
    mutationFn: memberId =>
      householdApi.updateMember(householdId, memberId, {
        status: 'removed',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.household.members(householdId),
      });
    },
    onError: error => {
      showErrorToast(
        getLocalizedErrorMessage(error, t, getRemoveMemberErrorKey(error))
      );
    },
  });
}

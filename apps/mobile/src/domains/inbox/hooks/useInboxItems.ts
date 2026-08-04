/**
 * @module domains/inbox/hooks/useInboxItems
 *
 * Composes household queries into one pending-work list across EVERY
 * household the user belongs to (not only the active switcher selection):
 * change requests (single GET /me/change-requests), co-parent approvals
 * (parent/owner only), pending schedule patterns, and queried timesheet
 * weeks (carer who must respond). Exposes an error channel so failures
 * never collapse to the empty-success state.
 *
 * Change requests use the me fan-in endpoint so NeedsAttentionCard on Today
 * does not fire one per-shift change-request list in the glance window.
 */
import { useQueries } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { listPendingApprovals } from '@/src/domains/inbox/api';
import { buildInboxItems } from '@/src/domains/inbox/utils/buildInboxItems';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useMePendingChangeRequests } from '@/src/hooks/queries/useMePendingChangeRequests';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';

export function useInboxItems() {
  const currentUserId = useAuthStore(s => s.session?.user?.id ?? null);
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const onboarding = useIsOnboarded();
  const role = onboarding.role;
  const active = useActiveHousehold();
  const households = active.households;
  const timeZone = active.household?.timezone ?? 'UTC';

  const today = localDateInZone(timeZone);
  // Glance window: recent + near-future shifts that may still carry a
  // pending change request awaiting the other side's response.
  const from = wallClockToUtcIso(addLocalDays(today, -7), '00:00', timeZone);
  const to = wallClockToUtcIso(addLocalDays(today, 21), '00:00', timeZone);

  const baseEnabled = !!session && isInitialized && households.length > 0;
  const parentEditor = isParentEditorRole(role);

  const patternsQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.schedulePattern.list(h.id),
      queryFn: () => schedulePatternApi.list(h.id),
      staleTime: QUERY_TIMING.STALE_1M,
      enabled: baseEnabled && isValidId(h.id),
    })),
  });

  const changeRequestsQuery = useMePendingChangeRequests(
    baseEnabled ? from : undefined,
    baseEnabled ? to : undefined
  );

  const approvalsQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.inbox.approvals(h.id),
      queryFn: () => listPendingApprovals(h.id),
      staleTime: QUERY_TIMING.STALE_1M,
      // Parent/owner only — nannies get 403 on GET /approvals.
      enabled: baseEnabled && parentEditor && isValidId(h.id),
    })),
  });

  const timesheetsQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.timesheet.list(h.id),
      queryFn: () => timesheetApi.list(h.id),
      staleTime: QUERY_TIMING.STALE_1M,
      enabled: baseEnabled && isValidId(h.id),
    })),
  });

  const changeRequests = useMemo(
    () => changeRequestsQuery.data ?? [],
    [changeRequestsQuery.data]
  );

  const patterns = useMemo(
    () => patternsQueries.flatMap(q => q.data ?? []),
    [patternsQueries]
  );

  const approvals = useMemo(
    () => approvalsQueries.flatMap(q => q.data ?? []),
    [approvalsQueries]
  );

  const timesheets = useMemo(
    () => timesheetsQueries.flatMap(q => q.data ?? []),
    [timesheetsQueries]
  );

  const items = useMemo(
    () =>
      buildInboxItems({
        role,
        currentUserId,
        changeRequests,
        approvals,
        patterns,
        timesheets,
      }),
    [role, currentUserId, changeRequests, approvals, patterns, timesheets]
  );

  // Initial load only — background refetch must not blank the list.
  const isLoading =
    active.isLoading ||
    onboarding.status === 'loading' ||
    patternsQueries.some(q => q.isLoading) ||
    (parentEditor && approvalsQueries.some(q => q.isLoading)) ||
    timesheetsQueries.some(q => q.isLoading) ||
    changeRequestsQuery.isLoading;

  const isError =
    active.isError ||
    patternsQueries.some(q => q.isError) ||
    (parentEditor && approvalsQueries.some(q => q.isError)) ||
    timesheetsQueries.some(q => q.isError) ||
    changeRequestsQuery.isError;

  const refetch = useCallback(() => {
    for (const q of patternsQueries) void q.refetch();
    for (const q of timesheetsQueries) void q.refetch();
    if (parentEditor) {
      for (const q of approvalsQueries) void q.refetch();
    }
    void changeRequestsQuery.refetch();
  }, [
    patternsQueries,
    timesheetsQueries,
    approvalsQueries,
    changeRequestsQuery,
    parentEditor,
  ]);

  return { items, isLoading, isError, refetch };
}

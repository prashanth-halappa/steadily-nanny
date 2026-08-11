/**
 * @module domains/inbox/hooks/useInboxItems
 *
 * Composes household queries into one pending-work list across EVERY
 * household the user belongs to (not only the active switcher selection):
 * change requests (single GET /me/change-requests), pending schedule
 * patterns, queried timesheet weeks (carer who must respond), — §2.2/§2.3a —
 * the carer's own pending shifts (single GET /me/shifts, the same fan-in
 * shape as change requests), and §7.1's live terms proposals. Exposes an
 * error channel so failures never collapse to the empty-success state.
 *
 * Change requests and shifts both use their `me` fan-in endpoint so
 * NeedsAttentionCard on Today does not fire one per-shift/per-household list
 * in the glance window.
 */
import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
} from '@steadily-nanny/shared-types';
import { useQueries } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { householdApi } from '@/src/api/endpoints/household';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { buildInboxItems } from '@/src/domains/inbox/utils/buildInboxItems';
import { isParentEditorRole, SETUP_ROLES } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useMePendingChangeRequests } from '@/src/hooks/queries/useMePendingChangeRequests';
import { useMeShifts } from '@/src/hooks/queries/useMeShifts';
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
  // §2.2/§2.3a — the same glance window and fan-in shape as change requests.
  const meShiftsQuery = useMeShifts(
    baseEnabled ? from : undefined,
    baseEnabled ? to : undefined
  );

  const timesheetsQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.timesheet.list(h.id),
      queryFn: () => timesheetApi.list(h.id),
      staleTime: QUERY_TIMING.STALE_1M,
      enabled: baseEnabled && isValidId(h.id),
    })),
  });

  // §7.1 — the proposal read is per (household, carer). A carer has exactly
  // one target per household (herself, no roster needed); a parent has to ask
  // per nanny, so the member lists feed the proposal queries below. Members
  // are fetched for parents only, and `candidate` rows count: D-38's
  // redemption leaves the nanny a candidate until her terms are accepted,
  // which is precisely when this item matters most.
  //
  // ponytail: N+1 by household x carer. There is no `GET /me/terms-proposals`
  // fan-in yet; when one lands this collapses to a single query the way
  // change requests and shifts already have.
  const membersQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.household.members(h.id),
      queryFn: () => householdApi.listMembers(h.id),
      staleTime: QUERY_TIMING.STALE_5M,
      enabled: baseEnabled && isValidId(h.id) && isParentEditorRole(role),
    })),
  });

  const proposalTargets = useMemo(() => {
    if (role === SETUP_ROLES.NANNY) {
      return currentUserId
        ? households.map(h => ({ householdId: h.id, carerId: currentUserId }))
        : [];
    }
    if (!isParentEditorRole(role)) return [];
    return households.flatMap((h, index) =>
      (membersQueries[index]?.data ?? [])
        .filter(
          m =>
            m.role === HOUSEHOLD_ROLES.NANNY &&
            m.status !== HOUSEHOLD_MEMBER_STATUSES.REMOVED
        )
        .map(m => ({ householdId: h.id, carerId: m.user_id }))
    );
  }, [role, currentUserId, households, membersQueries]);

  const proposalQueries = useQueries({
    queries: proposalTargets.map(target => ({
      queryKey: queryKeys.termsProposal.current(
        target.householdId,
        target.carerId
      ),
      queryFn: () =>
        termsProposalApi.getCurrent(target.householdId, target.carerId),
      staleTime: QUERY_TIMING.STALE_1M,
      enabled: baseEnabled,
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

  const timesheets = useMemo(
    () => timesheetsQueries.flatMap(q => q.data ?? []),
    [timesheetsQueries]
  );

  const meShifts = useMemo(
    () => meShiftsQuery.data ?? [],
    [meShiftsQuery.data]
  );

  // `getCurrent` answers `null` when nothing is on the table — a normal
  // result, dropped here rather than passed on as a hole in the list.
  const termsProposals = useMemo(
    () => proposalQueries.flatMap(q => (q.data ? [q.data] : [])),
    [proposalQueries]
  );

  const items = useMemo(
    () =>
      buildInboxItems({
        role,
        currentUserId,
        todayISO: today,
        changeRequests,
        patterns,
        timesheets,
        shifts: meShifts,
        termsProposals,
      }),
    [
      role,
      currentUserId,
      today,
      changeRequests,
      patterns,
      timesheets,
      meShifts,
      termsProposals,
    ]
  );

  // Initial load only — background refetch must not blank the list.
  const isLoading =
    active.isLoading ||
    onboarding.status === 'loading' ||
    patternsQueries.some(q => q.isLoading) ||
    timesheetsQueries.some(q => q.isLoading) ||
    changeRequestsQuery.isLoading ||
    meShiftsQuery.isLoading ||
    membersQueries.some(q => q.isLoading) ||
    proposalQueries.some(q => q.isLoading);

  const isError =
    active.isError ||
    patternsQueries.some(q => q.isError) ||
    timesheetsQueries.some(q => q.isError) ||
    changeRequestsQuery.isError ||
    meShiftsQuery.isError ||
    membersQueries.some(q => q.isError) ||
    proposalQueries.some(q => q.isError);

  const refetch = useCallback(() => {
    for (const q of patternsQueries) void q.refetch();
    for (const q of timesheetsQueries) void q.refetch();
    for (const q of membersQueries) void q.refetch();
    for (const q of proposalQueries) void q.refetch();
    void changeRequestsQuery.refetch();
    void meShiftsQuery.refetch();
  }, [
    patternsQueries,
    timesheetsQueries,
    membersQueries,
    proposalQueries,
    changeRequestsQuery,
    meShiftsQuery,
  ]);

  return { items, isLoading, isError, refetch };
}

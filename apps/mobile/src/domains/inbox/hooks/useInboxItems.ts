/**
 * @module domains/inbox/hooks/useInboxItems
 *
 * Composes household queries into one pending-work list across EVERY
 * household the user belongs to (not only the active switcher selection):
 * change requests (single GET /me/change-requests), pending schedule
 * patterns, queried timesheet weeks (carer who must respond), — §2.2/§2.3a —
 * the carer's own pending shifts (single GET /me/shifts, the same fan-in
 * shape as change requests), and §7.1's terms-proposal chain (the WHOLE
 * chain — D66 needs the declined round, which the open-proposal read
 * cannot return). Exposes an
 * error channel so failures never collapse to the empty-success state.
 *
 * Change requests and shifts both use their `me` fan-in endpoint so
 * NeedsAttentionCard on Today does not fire one per-shift/per-household list
 * in the glance window.
 *
 * WP-H — a change request names who asked, resolved against the household
 * member rosters fetched here (`membersQueries`, now every role's, not just
 * a parent's — see its own comment).
 */
import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
} from '@steadily-nanny/shared-types';
import { useQueries } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { householdApi } from '@/src/api/endpoints/household';
import { payArrangementApi } from '@/src/api/endpoints/payArrangements';
import { reimbursementSettlementApi } from '@/src/api/endpoints/reimbursementSettlements';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { timeOffApi } from '@/src/api/endpoints/timeOff';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import type { InboxTermsAckInput } from '@/src/domains/inbox/utils/buildInboxItems';
import { buildInboxItems } from '@/src/domains/inbox/utils/buildInboxItems';
import { isParentEditorRole, SETUP_ROLES } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdLookup } from '@/src/hooks/queries/useHouseholdById';
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
  const isPastMember = onboarding.isPastMember;
  const active = useActiveHousehold();
  const households = active.households;
  const { timeZoneFor } = useHouseholdLookup();
  // Kept for the single-zone `todayISO` fallback below and the "no
  // households yet" edge case — everything else resolves PER HOUSEHOLD
  // (Pattern A: one household's local midnight is not another's).
  const timeZone = active.household?.timezone ?? 'UTC';
  const today = localDateInZone(timeZone);

  const todayISOFor = useCallback(
    (householdId: string) => localDateInZone(timeZoneFor(householdId)),
    [timeZoneFor]
  );

  // Glance window: recent + near-future shifts that may still carry a
  // pending change request awaiting the other side's response — widened to
  // the UNION of every household's own window (earliest `from`, latest
  // `to`), so a household in a zone ahead/behind the active one never has
  // its own glance window clipped to the active household's.
  const { from, to } = useMemo(() => {
    if (households.length === 0) {
      return {
        from: wallClockToUtcIso(addLocalDays(today, -7), '00:00', timeZone),
        to: wallClockToUtcIso(addLocalDays(today, 21), '00:00', timeZone),
      };
    }
    const windows = households.map(h => {
      const hTimeZone = timeZoneFor(h.id);
      const hToday = localDateInZone(hTimeZone);
      return {
        from: wallClockToUtcIso(addLocalDays(hToday, -7), '00:00', hTimeZone),
        to: wallClockToUtcIso(addLocalDays(hToday, 21), '00:00', hTimeZone),
      };
    });
    // ISO 8601 UTC timestamps ('...Z') sort lexically the same as
    // chronologically, so a plain string min/max is exact here.
    return {
      from: windows.reduce(
        (min, w) => (w.from < min ? w.from : min),
        windows[0]?.from ?? ''
      ),
      to: windows.reduce(
        (max, w) => (w.to > max ? w.to : max),
        windows[0]?.to ?? ''
      ),
    };
  }, [households, timeZoneFor, today, timeZone]);

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

  // §2.2 rank 8 — parent/owner only; one aggregate per household.
  const unsettledReimbursementQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.reimbursementSettlements.unsettled(h.id),
      queryFn: () => reimbursementSettlementApi.listUnsettled(h.id),
      staleTime: QUERY_TIMING.STALE_1M,
      enabled: baseEnabled && isValidId(h.id) && isParentEditorRole(role),
    })),
  });

  // D77 — parent/owner only; one list per household, on the same key and
  // staleTime `useHouseholdTimeOff` uses, so the settings screen and this
  // list share one cache entry rather than double-fetching.
  const timeOffQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.timeOff.forHousehold(h.id),
      queryFn: () => timeOffApi.listForHousehold(h.id),
      staleTime: QUERY_TIMING.STALE_2M,
      enabled: baseEnabled && isValidId(h.id) && isParentEditorRole(role),
    })),
  });

  // §7.1 — the proposal read is per (household, carer). A carer has exactly
  // one target per household (herself, no roster needed); a parent has to ask
  // per nanny, so the member lists feed the proposal queries below, and
  // `candidate` rows count: D-38's redemption leaves the nanny a candidate
  // until her terms are accepted, which is precisely when this item matters
  // most. WP-H also reads this same roster — regardless of role — to name a
  // change request's author, so it is fetched for every viewer now, not
  // parents only; still one query per household, the fan-in this module doc
  // asks for.
  //
  // ponytail: N+1 by household x carer for the proposal reads specifically.
  // There is no `GET /me/terms-proposals` fan-in yet; when one lands this
  // collapses to a single query the way change requests and shifts already
  // have.
  const membersQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.household.members(h.id),
      queryFn: () => householdApi.listMembers(h.id),
      staleTime: QUERY_TIMING.STALE_5M,
      enabled: baseEnabled && isValidId(h.id),
    })),
  });

  // WP-H — every household's roster, flattened: `buildInboxItems` can name a
  // change request's author without knowing which household it belongs to
  // (the wire carries no household id on that row).
  const householdMembers = useMemo(
    () => membersQueries.flatMap(q => q.data ?? []),
    [membersQueries]
  );

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

  // The whole CHAIN, not `getCurrent` — D66. `getCurrent` answers only the
  // `proposed` round, so a DECLINED one could never reach `buildInboxItems`
  // and the author's record of a refusal would be unreachable code. Same
  // query count as before, and the same key `useTermsProposals` already
  // uses, so the pay screen and this list share one cache entry.
  const proposalQueries = useQueries({
    queries: proposalTargets.map(target => ({
      queryKey: queryKeys.termsProposal.list(
        target.householdId,
        target.carerId
      ),
      queryFn: () => termsProposalApi.list(target.householdId, target.carerId),
      staleTime: QUERY_TIMING.STALE_1M,
      enabled: baseEnabled,
    })),
  });

  // §2.2 rank 9 — nanny-only ack rows need the live arrangement + its ack list.
  const arrangementQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.pay.current(h.id, currentUserId ?? undefined),
      queryFn: () =>
        payArrangementApi.getCurrent(h.id, currentUserId as string),
      staleTime: QUERY_TIMING.STALE_1M,
      enabled:
        baseEnabled &&
        role === SETUP_ROLES.NANNY &&
        !isPastMember &&
        isValidId(h.id) &&
        isValidId(currentUserId),
    })),
  });

  const arrangementHistoryQueries = useQueries({
    queries: households.map((h, index) => {
      const arrangement = arrangementQueries[index]?.data;
      return {
        queryKey: queryKeys.pay.history(h.id, currentUserId ?? undefined),
        queryFn: () =>
          payArrangementApi.getHistory(h.id, currentUserId as string),
        staleTime: QUERY_TIMING.STALE_1M,
        enabled:
          baseEnabled &&
          role === SETUP_ROLES.NANNY &&
          !isPastMember &&
          isValidId(h.id) &&
          isValidId(currentUserId) &&
          arrangement != null,
      };
    }),
  });

  const arrangementAckQueries = useQueries({
    queries: households.map((h, index) => {
      const arrangement = arrangementQueries[index]?.data;
      return {
        queryKey: queryKeys.pay.acks(
          h.id,
          currentUserId ?? undefined,
          arrangement?.id
        ),
        queryFn: () =>
          payArrangementApi.listAcks(
            h.id,
            currentUserId as string,
            arrangement?.id as string
          ),
        staleTime: QUERY_TIMING.STALE_1M,
        enabled:
          baseEnabled &&
          role === SETUP_ROLES.NANNY &&
          !isPastMember &&
          isValidId(h.id) &&
          isValidId(currentUserId) &&
          isValidId(arrangement?.id),
      };
    }),
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

  // Every round for every carer, flattened. An empty chain is a normal
  // result (nobody has proposed yet), not a hole in the list.
  const termsProposals = useMemo(
    () => proposalQueries.flatMap(q => q.data ?? []),
    [proposalQueries]
  );

  const termsAcks = useMemo((): InboxTermsAckInput[] => {
    if (role !== SETUP_ROLES.NANNY || isPastMember || !currentUserId) {
      return [];
    }
    const rows: InboxTermsAckInput[] = [];
    for (let index = 0; index < households.length; index++) {
      const arrangement = arrangementQueries[index]?.data;
      if (!arrangement) continue;
      const history = arrangementHistoryQueries[index]?.data ?? [];
      const historyIndex = history.findIndex(row => row.id === arrangement.id);
      const isFirstTerms =
        historyIndex < 0 || history[historyIndex + 1] == null;
      rows.push({
        household_id: households[index]?.id ?? '',
        arrangement_id: arrangement.id,
        valid_from: arrangement.valid_from,
        is_first_terms: isFirstTerms,
        acks: arrangementAckQueries[index]?.data ?? [],
      });
    }
    return rows;
  }, [
    role,
    isPastMember,
    currentUserId,
    households,
    arrangementQueries,
    arrangementHistoryQueries,
    arrangementAckQueries,
  ]);

  const unsettledReimbursements = useMemo(
    () =>
      unsettledReimbursementQueries.flatMap((q, index) =>
        (q.data ?? []).map(week => ({
          ...week,
          household_id: households[index]?.id ?? '',
        }))
      ),
    [unsettledReimbursementQueries, households]
  );

  // The wire row carries no household id (time off is scoped to the CARER),
  // so it is stamped on from the query's own household — same shape as the
  // unsettled-reimbursement flatten above.
  const timeOff = useMemo(
    () =>
      timeOffQueries.flatMap((q, index) =>
        (q.data ?? []).map(row => ({
          ...row,
          household_id: households[index]?.id ?? '',
        }))
      ),
    [timeOffQueries, households]
  );

  const items = useMemo(
    () =>
      buildInboxItems({
        role,
        currentUserId,
        todayISO: today,
        todayISOFor,
        isPastMember,
        changeRequests,
        patterns,
        timesheets,
        shifts: meShifts,
        termsProposals,
        termsAcks,
        unsettledReimbursements,
        timeOff,
        households,
        householdMembers,
      }),
    [
      role,
      currentUserId,
      today,
      todayISOFor,
      isPastMember,
      changeRequests,
      patterns,
      timesheets,
      meShifts,
      termsProposals,
      termsAcks,
      unsettledReimbursements,
      timeOff,
      households,
      householdMembers,
    ]
  );

  // Initial load only — background refetch must not blank the list.
  // `onboarding.status === 'loading'` alone would stay true FOREVER on a
  // failed memberships read (`useIsOnboarded` reports that case as
  // `status: 'loading'` permanently, by design — see its own header
  // comment), which pins `isLoading` true and makes the `isError` branch
  // below unreachable to any caller that checks `isLoading` first (C6,
  // docs/CROSS-CUTTING-DEFECT-PATTERNS.md) — `!onboarding.membershipsError`
  // is what lets the error actually surface.
  const isLoading =
    active.isLoading ||
    (onboarding.status === 'loading' && !onboarding.membershipsError) ||
    patternsQueries.some(q => q.isLoading) ||
    timesheetsQueries.some(q => q.isLoading) ||
    changeRequestsQuery.isLoading ||
    meShiftsQuery.isLoading ||
    membersQueries.some(q => q.isLoading) ||
    proposalQueries.some(q => q.isLoading) ||
    arrangementQueries.some(q => q.isLoading) ||
    arrangementHistoryQueries.some(q => q.isLoading) ||
    arrangementAckQueries.some(q => q.isLoading) ||
    unsettledReimbursementQueries.some(q => q.isLoading) ||
    timeOffQueries.some(q => q.isLoading);

  const isError =
    active.isError ||
    onboarding.membershipsError ||
    patternsQueries.some(q => q.isError) ||
    timesheetsQueries.some(q => q.isError) ||
    changeRequestsQuery.isError ||
    meShiftsQuery.isError ||
    membersQueries.some(q => q.isError) ||
    proposalQueries.some(q => q.isError) ||
    arrangementQueries.some(q => q.isError) ||
    arrangementHistoryQueries.some(q => q.isError) ||
    arrangementAckQueries.some(q => q.isError) ||
    unsettledReimbursementQueries.some(q => q.isError) ||
    timeOffQueries.some(q => q.isError);

  const refetch = useCallback(() => {
    onboarding.retryMemberships();
    for (const q of patternsQueries) void q.refetch();
    for (const q of timesheetsQueries) void q.refetch();
    for (const q of membersQueries) void q.refetch();
    for (const q of proposalQueries) void q.refetch();
    for (const q of arrangementQueries) void q.refetch();
    for (const q of arrangementHistoryQueries) void q.refetch();
    for (const q of arrangementAckQueries) void q.refetch();
    for (const q of unsettledReimbursementQueries) void q.refetch();
    for (const q of timeOffQueries) void q.refetch();
    void changeRequestsQuery.refetch();
    void meShiftsQuery.refetch();
  }, [
    onboarding.retryMemberships,
    patternsQueries,
    timesheetsQueries,
    membersQueries,
    proposalQueries,
    arrangementQueries,
    arrangementHistoryQueries,
    arrangementAckQueries,
    unsettledReimbursementQueries,
    timeOffQueries,
    changeRequestsQuery,
    meShiftsQuery,
  ]);

  return { items, isLoading, isError, refetch };
}

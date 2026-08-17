/**
 * Centralized Query Keys
 *
 * All TanStack Query keys are defined here for consistency and easy
 * invalidation. Keys are organized hierarchically by domain.
 *
 * Usage:
 * ```ts
 * import { queryKeys } from '@/src/api/queryKeys';
 *
 * // In a query hook
 * useQuery({
 *   queryKey: queryKeys.user.profile(userId),
 *   queryFn: () => userApi.getProfile(),
 * });
 *
 * // Invalidating queries
 * queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
 * ```
 */

export const queryKeys = {
  // Authenticated user (account owner)
  user: {
    all: ['user'] as const,
    profile: (userId?: string) =>
      [...queryKeys.user.all, 'profile', userId] as const,
    memberships: () => [...queryKeys.user.all, 'memberships'] as const,
  },

  // Remote app config (force update, kill switch, announcements, beta override)
  appConfig: {
    all: ['appConfig'] as const,
    status: () => [...queryKeys.appConfig.all, 'status'] as const,
  },

  // Push device registrations + per-user prefs (opt-outs / quiet hours)
  notifications: {
    all: ['notifications'] as const,
    devices: () => [...queryKeys.notifications.all, 'devices'] as const,
    prefs: () => [...queryKeys.notifications.all, 'prefs'] as const,
  },

  // Households, membership, invites
  household: {
    all: ['household'] as const,
    list: () => [...queryKeys.household.all, 'list'] as const,
    // Households the caller was REMOVED from — read-only history only, kept
    // off `list` so nothing that gates a write ever sees one.
    past: () => [...queryKeys.household.all, 'past'] as const,
    detail: (householdId?: string) =>
      [...queryKeys.household.all, 'detail', householdId] as const,
    members: (householdId?: string) =>
      [...queryKeys.household.all, 'members', householdId] as const,
    invitePreview: (code?: string) =>
      [...queryKeys.household.all, 'invitePreview', code] as const,
    // Every code this household has minted. Shape must stay
    // ['household','invites',id] — `draftQueryKeys.invites` has been using
    // that literal since before this block existed and now delegates here.
    invites: (householdId?: string) =>
      [...queryKeys.household.all, 'invites', householdId] as const,
  },

  // A household's children
  children: {
    all: ['children'] as const,
    list: (householdId?: string) =>
      [...queryKeys.children.all, 'list', householdId] as const,
  },

  // Per-child fixed commitments (preschool, school, naps…)
  commitments: {
    all: ['commitments'] as const,
    list: (householdId?: string, childId?: string) =>
      [...queryKeys.commitments.all, 'list', householdId, childId] as const,
    byHousehold: (householdId?: string) =>
      [...queryKeys.commitments.all, 'household', householdId] as const,
  },

  // Daily handoff notes (morning/evening chips)
  handoff: {
    all: ['handoff'] as const,
    list: (householdId?: string, localDate?: string) =>
      [...queryKeys.handoff.all, 'list', householdId, localDate] as const,
    recap: (householdId?: string, localDate?: string) =>
      [...queryKeys.handoff.all, 'recap', householdId, localDate] as const,
  },

  // The signed-in nanny's own weekly availability
  availability: {
    all: ['availability'] as const,
    mine: () => [...queryKeys.availability.all, 'mine'] as const,
    // Another user's weekly availability — a parent checking a carer's stated
    // hours while building a schedule with them. Keyed by user id so one
    // carer's cached rows can never be served for another.
    forUser: (userId?: string) =>
      [...queryKeys.availability.all, 'forUser', userId] as const,
    // A carer's cross-household busy spans, ANONYMISED. Keyed by carer + range
    // so one family's cached view can never be reused as another's.
    busy: (carerId?: string, from?: string, to?: string) =>
      [...queryKeys.availability.all, 'busy', carerId, from, to] as const,
  },

  // The signed-in carer's own time off. Deliberately takes NO arguments on
  // `list`: `GET /time-off` is scoped by the caller's identity on the server.
  // `forHousehold` keys the parent-facing household carers list.
  timeOff: {
    all: ['timeOff'] as const,
    list: () => [...queryKeys.timeOff.all, 'list'] as const,
    forHousehold: (householdId?: string) =>
      [...queryKeys.timeOff.all, 'household', householdId] as const,
  },

  // Parent-declared household closures ("we're away, no cover needed").
  // Distinct from `timeOff` (carer-scoped) — a closure is scoped to ONE
  // household, so `list` always takes the household id.
  householdClosures: {
    all: ['householdClosures'] as const,
    list: (householdId?: string) =>
      [...queryKeys.householdClosures.all, 'list', householdId] as const,
  },

  // Recurring schedule patterns: the "usual week" a parent proposes.
  schedulePattern: {
    all: ['schedulePattern'] as const,
    list: (householdId?: string) =>
      [...queryKeys.schedulePattern.all, 'list', householdId] as const,
    detail: (patternId?: string) =>
      [...queryKeys.schedulePattern.all, 'detail', patternId] as const,
  },

  // Materialised shift instances.
  shift: {
    all: ['shift'] as const,
    // Range-scoped: a week view and a month view are different cache entries,
    // so scrolling the calendar cannot serve stale rows from another window.
    range: (householdId?: string, from?: string, to?: string) =>
      [...queryKeys.shift.all, 'range', householdId, from, to] as const,
    detail: (shiftId?: string) =>
      [...queryKeys.shift.all, 'detail', shiftId] as const,
    events: (householdId?: string, shiftId?: string) =>
      [...queryKeys.shift.all, 'events', householdId, shiftId] as const,
    dayThread: (householdId?: string, localDate?: string) =>
      [...queryKeys.shift.all, 'dayThread', householdId, localDate] as const,
    changeRequests: (shiftId?: string) =>
      [...queryKeys.shift.all, 'changeRequests', shiftId] as const,
  },

  // Clock in/out and the weekly hours roll-up.
  timeEntry: {
    all: ['timeEntry'] as const,
    // The single open entry, if the carer is currently on the clock.
    running: () => [...queryKeys.timeEntry.all, 'running'] as const,
    week: (householdId?: string, weekStart?: string) =>
      [...queryKeys.timeEntry.all, 'week', householdId, weekStart] as const,
  },

  timesheet: {
    all: ['timesheet'] as const,
    list: (householdId?: string) =>
      [...queryKeys.timesheet.all, 'list', householdId] as const,
    week: (householdId?: string, weekStart?: string) =>
      [...queryKeys.timesheet.all, 'week', householdId, weekStart] as const,
    // What was SAID about one week (D-18). Keyed on the timesheet id, not
    // the household week: the thread belongs to one carer's row, and in a
    // two-carer household a week-keyed entry would serve one carer's
    // conversation to the other.
    thread: (timesheetId?: string) =>
      [...queryKeys.timesheet.all, 'thread', timesheetId] as const,
  },

  // Cross-household "me" reads (carer's own shifts + pending change requests).
  me: {
    all: ['me'] as const,
    shifts: (from?: string, to?: string) =>
      [...queryKeys.me.all, 'shifts', from, to] as const,
    changeRequests: (from?: string, to?: string) =>
      [...queryKeys.me.all, 'changeRequests', from, to] as const,
  },

  // Pay arrangements: the effective-dated hourly rate + terms for one carer
  // in one household. Both `current` and `history` take the same
  // (householdId, carerId) pair — the arrangement is meaningless outside
  // that pair (docs/11-MONEY.md §2) — so a create must invalidate both.
  pay: {
    all: ['pay'] as const,
    current: (householdId?: string, carerId?: string) =>
      [...queryKeys.pay.all, 'current', householdId, carerId] as const,
    history: (householdId?: string, carerId?: string) =>
      [...queryKeys.pay.all, 'history', householdId, carerId] as const,
    // D-31 ack/dissent rows (081) hang off ONE arrangement version, not off
    // the (household, carer) pair — a new version starts with no acks, so
    // the arrangement id has to be in the key or the previous version's
    // "Seen" would be shown against terms nobody has read yet.
    acks: (householdId?: string, carerId?: string, arrangementId?: string) =>
      [
        ...queryKeys.pay.all,
        'acks',
        householdId,
        carerId,
        arrangementId,
      ] as const,
  },

  // Terms proposals (D-35/D-38/D-49): the negotiation that happens BEFORE any
  // pay arrangement exists. Scoped to the same (householdId, carerId) pair as
  // `pay` — two nannies in one household run two independent negotiations and
  // must never see each other's (D-21).
  //
  // `history` is NOT foldable into `current`. A counter is a NEW row pointing
  // at the one it answered (`supersedes_id`), never an edit over it, so
  // `current` is one live row while the chain behind it is the audit trail
  // §7.2 renders as "How we got here". Deriving one from the other would mean
  // either caching the whole chain to show one card, or throwing the chain
  // away to keep the card cheap. Hence two keys — and hence every mutation
  // invalidates BOTH: a counter changes what "current" resolves to AND appends
  // to the chain.
  termsProposal: {
    all: ['termsProposal'] as const,
    current: (householdId?: string, carerId?: string) =>
      [
        ...queryKeys.termsProposal.all,
        'current',
        householdId,
        carerId,
      ] as const,
    list: (householdId?: string, carerId?: string) =>
      [...queryKeys.termsProposal.all, 'list', householdId, carerId] as const,
    detail: (proposalId?: string) =>
      [...queryKeys.termsProposal.all, 'detail', proposalId] as const,
  },

  // Paid time off (Phase 3). Balance is per calendar year — the year is part
  // of the key so switching years refetches rather than showing last year's
  // figure under this year's heading.
  pto: {
    all: ['pto'] as const,
    balance: (householdId?: string, carerId?: string, year?: number) =>
      [...queryKeys.pto.all, 'balance', householdId, carerId, year] as const,
    ledger: (householdId?: string, carerId?: string, year?: number) =>
      [...queryKeys.pto.all, 'ledger', householdId, carerId, year] as const,
  },

  // Settlement payments (067): rows recorded against one approved week.
  // `forTimesheet` scopes one week's ledger; `forHousehold` scopes the whole
  // household's payment history across every carer and week. A
  // record-payment mutation invalidates `all` (a prefix of both) — plus the
  // timesheet.week read that renders the paid badge.
  payment: {
    all: ['payment'] as const,
    forTimesheet: (timesheetId?: string) =>
      [...queryKeys.payment.all, 'forTimesheet', timesheetId] as const,
    forHousehold: (householdId?: string) =>
      [...queryKeys.payment.all, 'forHousehold', householdId] as const,
  },

  // Expenses and mileage (Phase 4). `week` is keyed by the household-local
  // week start, matching how timesheet keys its weeks.
  expenses: {
    all: ['expenses'] as const,
    week: (householdId?: string, weekStart?: string) =>
      [...queryKeys.expenses.all, 'week', householdId, weekStart] as const,
    pending: (householdId?: string) =>
      [...queryKeys.expenses.all, 'pending', householdId] as const,
  },

  // Reimbursement settlements (D-14) — "the family paid her back", keyed by
  // the same household-local week as `expenses`. A SEPARATE key from
  // `payment` on purpose: a settlement is not a payment, and one cache
  // holding both would be the first step toward summing them together.
  reimbursementSettlements: {
    all: ['reimbursementSettlements'] as const,
    week: (householdId?: string, weekStart?: string) =>
      [
        ...queryKeys.reimbursementSettlements.all,
        'week',
        householdId,
        weekStart,
      ] as const,
    unsettled: (householdId?: string) =>
      [
        ...queryKeys.reimbursementSettlements.all,
        'unsettled',
        householdId,
      ] as const,
  },
} as const;

/**
 * Type for query key arrays
 */
export type QueryKey = readonly unknown[];

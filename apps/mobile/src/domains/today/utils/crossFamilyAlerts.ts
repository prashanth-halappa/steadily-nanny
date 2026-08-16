/**
 * @module domains/today/utils/crossFamilyAlerts
 *
 * Pure resolver for P5's cross-family alert strip (A2). A nanny scoped to
 * ONE household on Today can't see anything urgent in her OTHER households
 * until she switches — and has no reason to switch unless she already knows.
 * The strip's entire value is scarcity, so exactly three facts qualify, each
 * one something that becomes wrong or lost if she doesn't see it before
 * switching there on her own:
 *
 *  - `runningClock` — a time entry still running in another household. An
 *    unclosed entry corrupts that household's pay record the longer it runs.
 *  - `termsBlock` — a live `terms_proposal` in another household where she
 *    has a shift TODAY there — the terms gate (A1) would otherwise cost her
 *    a paid shift she is about to work.
 *  - `pendingShift` — a pending shift in another household starting within
 *    48h. It expires.
 *
 * Everything else — ordinary inbox noise from another household — survives
 * until she switches and belongs to THAT household's own Today, where the
 * attention ladder already handles it (`attentionOwner.ts`).
 *
 * `buildInboxItems`'s `pending_shift` item does not carry a `householdId`
 * (the inbox domain's builders are out of this stream's scope), so this
 * reads `meShifts` — the same raw `GET /me/shifts` rows `useMeShifts` already
 * exposes — directly for the `pendingShift` rule and for `termsBlock`'s "has
 * a shift today" check, rather than the transformed inbox item.
 *
 * One alert per household — its own highest-ranked reason, never two lines
 * for the same family — ordered `runningClock` > `termsBlock` >
 * `pendingShift` (rung order: what corrupts a record outranks what merely
 * expires).
 */
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';

export type CrossFamilyAlertKind =
  | 'runningClock'
  | 'termsBlock'
  | 'pendingShift';

export type CrossFamilyAlert = {
  householdId: string;
  familyName: string;
  kind: CrossFamilyAlertKind;
  /** ISO clock-in instant — only present for `runningClock`. */
  since?: string;
};

export type CrossFamilyHousehold = {
  id: string;
  name: string | null;
};

/** The `meShifts` fields this resolver needs — a `MeShift` row assigns straight to it. */
export type CrossFamilyShift = {
  household_id: string;
  status: string;
  starts_at: string;
  local_date: string;
};

export type CrossFamilyRunningEntry = {
  household_id: string;
  clock_in_at: string | null;
} | null;

const RANK: Record<CrossFamilyAlertKind, number> = {
  runningClock: 0,
  termsBlock: 1,
  pendingShift: 2,
};

/** Same window `buildInboxItems`'s §2.2 ordering uses for `pending_shift`. */
const PENDING_SHIFT_WINDOW_HOURS = 48;

/** Statuses that mean "not actually happening" — never count as "a shift today". */
const NOT_HAPPENING_STATUSES = new Set(['cancelled', 'declined']);

export function resolveCrossFamilyAlerts(input: {
  items: readonly InboxItem[];
  runningEntry: CrossFamilyRunningEntry | undefined;
  activeHouseholdId: string | null | undefined;
  households: readonly CrossFamilyHousehold[];
  meShifts: readonly CrossFamilyShift[];
  /** Today's local date (`YYYY-MM-DD`), same convention `useInboxItems`
   * already uses: computed once, from the ACTIVE household's timezone. */
  todayLocalDate: string;
  /** Injectable for deterministic tests — defaults to `Date.now()`. */
  nowISO?: string;
}): CrossFamilyAlert[] {
  const {
    items,
    runningEntry,
    activeHouseholdId,
    households,
    meShifts,
    todayLocalDate,
  } = input;
  const nowMs = input.nowISO ? Date.parse(input.nowISO) : Date.now();

  const alerts: CrossFamilyAlert[] = [];

  for (const household of households) {
    if (household.id === activeHouseholdId) continue;
    const familyName = household.name ?? '';

    if (
      runningEntry?.household_id === household.id &&
      runningEntry.clock_in_at
    ) {
      alerts.push({
        householdId: household.id,
        familyName,
        kind: 'runningClock',
        since: runningEntry.clock_in_at,
      });
      continue;
    }

    const hasShiftToday = meShifts.some(
      shift =>
        shift.household_id === household.id &&
        shift.local_date === todayLocalDate &&
        !NOT_HAPPENING_STATUSES.has(shift.status)
    );
    const hasTermsProposal = items.some(
      item =>
        item.kind === 'terms_proposal' && item.householdId === household.id
    );
    if (hasTermsProposal && hasShiftToday) {
      alerts.push({
        householdId: household.id,
        familyName,
        kind: 'termsBlock',
      });
      continue;
    }

    const hasExpiringPendingShift = meShifts.some(shift => {
      if (shift.household_id !== household.id) return false;
      if (shift.status !== 'pending') return false;
      const hoursUntilStart = (Date.parse(shift.starts_at) - nowMs) / 3_600_000;
      return hoursUntilStart <= PENDING_SHIFT_WINDOW_HOURS;
    });
    if (hasExpiringPendingShift) {
      alerts.push({
        householdId: household.id,
        familyName,
        kind: 'pendingShift',
      });
    }
  }

  return alerts.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

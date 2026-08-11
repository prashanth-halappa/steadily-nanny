/**
 * @module domains/inbox/utils/buildInboxItems
 *
 * Pure aggregator for the pending-work inbox. Keeps filtering out of the
 * screen so each item type has a single, testable gate:
 *
 *  - change requests: pending AND opened by someone else (awaiting me)
 *  - pending patterns: status pending AND addressed to me as carer
 *  - queried weeks: status === 'queried' AND carer_id === me (not the parent
 *    who raised the query)
 *  - submitted weeks: status === 'submitted' AND viewer is a parent/owner —
 *    a carer must never see her own submission surface back at her here.
 *  - stale submitted weeks: status === 'submitted', carer_id === me, and
 *    sent more than 14 days ago (D-46 / M13). The carer's copy of the same
 *    week the item above is the parent's; they are different items for
 *    different people, and neither resolves in place.
 *  - pending shifts: status === 'pending' AND carer_id === me AND role is
 *    the nanny — a cover-ask, an extra-shift proposal, and a
 *    demoted-shift-needing-reconfirm are all the SAME fact ("a shift is
 *    waiting on your answer") and share one kind (§2.2). The role check is
 *    explicit, not left to the carer_id match alone (B5) — a helper is never
 *    a real carer_id match by data, but this makes the exclusion true by
 *    construction, not by happenstance, and is pinned by a test.
 *
 * §2.2's urgency ordering: items are sorted by `sortKey` ascending (a rank
 * per kind, `pending_shift` forking on whether the shift starts within 48h),
 * ties broken by the date the item concerns, soonest first. Ranks the spec
 * assigns to kinds this build does not add (`terms_proposal`,
 * `reimbursement_owed`, `terms_ack` — see the module doc on `inboxItemCopy.ts`
 * for why) are reserved rather than reused, so a later slice slots in without
 * renumbering everything here.
 */

import {
  isParentEditorRole,
  SETUP_ROLES,
  type SetupRole,
} from '@/src/domains/setup/types';

export type InboxChangeRequestInput = {
  id: string;
  shift_id: string;
  requested_by: string | null;
  kind: string;
  status: string;
};

export type InboxPatternInput = {
  id: string;
  carer_id: string | null;
  status: string;
  dtstart: string;
};

export type InboxTimesheetInput = {
  id: string;
  carer_id: string | null;
  week_start: string;
  status: string;
  query_note: string | null;
  /** Snapshotted carer name — optional so pre-existing fixtures still type-check. */
  carer_display_name?: string;
  /** The week's banked minutes, for `stale_submitted_week`'s subtitle. */
  total_minutes?: number;
  /**
   * Stand-in for a submission timestamp, which the wire does not carry.
   * A submitted week stops changing once she sends it, so `updated_at` IS
   * the moment she sent it — and when it is not (an edit re-ran the roll-up
   * and re-submitted), the clock legitimately restarts, because the record
   * she is waiting on changed. It can only ever UNDERSTATE the wait, which
   * is the safe direction: this item must never manufacture a grievance.
   *
   * ponytail: a real `submitted_at` on the timesheet row would make this
   * exact; add one if the figure is ever disputed.
   */
  updated_at?: string;
};

export type InboxShiftInput = {
  id: string;
  carer_id: string | null;
  status: string;
  local_date: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  /** Null on any shift that is not an outstanding ask (migration 088). */
  cover_ask_expires_at?: string | null;
};

export type InboxItem =
  | {
      kind: 'change_request';
      id: string;
      shiftId: string;
      requestKind: string;
    }
  | {
      kind: 'pending_pattern';
      id: string;
      patternId: string;
      dtstart: string;
    }
  | {
      kind: 'queried_week';
      id: string;
      weekStart: string;
      queryNote: string | null;
    }
  | {
      kind: 'submitted_week';
      id: string;
      weekStart: string;
      carerDisplayName: string | null;
    }
  | {
      kind: 'stale_submitted_week';
      id: string;
      weekStart: string;
      daysAgo: number;
      totalMinutes: number;
    }
  | {
      kind: 'pending_shift';
      id: string;
      localDate: string;
      startsAt: string;
      endsAt: string;
      createdAt: string;
      coverAskExpiresAt: string | null;
    };

/**
 * How long a week may sit `submitted` before the carer gets told (D-46).
 * 14, not 3, deliberately: `timesheet_awaiting_approval` starts nudging the
 * PARENT at 3 (`TIMESHEET_SUBMITTED_DAYS`), and telling her a week is late
 * before that loop has had a fair run manufactures a grievance out of a
 * normal Friday.
 */
const STALE_SUBMITTED_DAYS = 14;

/** Whole days between two YYYY-MM-DD calendar dates. */
function daysBetween(fromISO: string, toISO: string): number {
  const utcMs = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((utcMs(toISO) - utcMs(fromISO)) / 86_400_000);
}

export function buildInboxItems(input: {
  role: SetupRole | null;
  currentUserId: string | null | undefined;
  /** Today in the household's zone — the clock `stale_submitted_week` is
   * measured against. */
  todayISO: string;
  /** The current instant, for §2.2's ordering (`pending_shift`'s within-48h
   * fork) — injectable for deterministic tests, defaults to `Date.now()`. */
  nowISO?: string;
  changeRequests: readonly InboxChangeRequestInput[];
  patterns: readonly InboxPatternInput[];
  timesheets: readonly InboxTimesheetInput[];
  shifts?: readonly InboxShiftInput[];
}): InboxItem[] {
  const me = input.currentUserId ?? null;
  const nowMs = input.nowISO ? Date.parse(input.nowISO) : Date.now();
  const items: InboxItem[] = [];

  for (const req of input.changeRequests) {
    if (req.status !== 'pending') continue;
    if (!me || req.requested_by === me) continue;
    items.push({
      kind: 'change_request',
      id: req.id,
      shiftId: req.shift_id,
      requestKind: req.kind,
    });
  }

  for (const pattern of input.patterns) {
    if (pattern.status !== 'pending') continue;
    if (!me || pattern.carer_id !== me) continue;
    items.push({
      kind: 'pending_pattern',
      id: pattern.id,
      patternId: pattern.id,
      dtstart: pattern.dtstart,
    });
  }

  for (const sheet of input.timesheets) {
    if (sheet.status !== 'queried') continue;
    // Only the carer who must respond — not the parent who raised the query.
    if (!me || sheet.carer_id !== me) continue;
    items.push({
      kind: 'queried_week',
      id: sheet.id,
      weekStart: sheet.week_start,
      queryNote: sheet.query_note,
    });
  }

  // Submitted weeks are a parent/owner review surface — a carer must never
  // see her own submission bounce back at her as "pending work" here (she
  // already knows; nothing is awaiting HER response).
  if (isParentEditorRole(input.role)) {
    for (const sheet of input.timesheets) {
      if (sheet.status !== 'submitted') continue;
      items.push({
        kind: 'submitted_week',
        id: sheet.id,
        weekStart: sheet.week_start,
        carerDisplayName: sheet.carer_display_name ?? null,
      });
    }
  }

  // D-46 / M13 — carer-side, and inbox-only: she already got the roll-up's
  // counterpart, and a push about her employer's inaction is a buzz she
  // cannot act on.
  for (const sheet of input.timesheets) {
    if (sheet.status !== 'submitted') continue;
    if (!me || sheet.carer_id !== me) continue;
    // No submission date or no hours means no item — never one with a blank
    // or zero figure in place of a fact we do not have.
    if (!sheet.updated_at || sheet.total_minutes == null) continue;
    const daysAgo = daysBetween(sheet.updated_at, input.todayISO);
    if (daysAgo <= STALE_SUBMITTED_DAYS) continue;
    items.push({
      kind: 'stale_submitted_week',
      id: sheet.id,
      weekStart: sheet.week_start,
      daysAgo,
      totalMinutes: sheet.total_minutes,
    });
  }

  // §2.2/§2.3a — B5: the role check is explicit, not left to the carer_id
  // match alone. See the module doc.
  if (input.role === SETUP_ROLES.NANNY) {
    for (const shift of input.shifts ?? []) {
      if (shift.status !== 'pending') continue;
      if (!me || shift.carer_id !== me) continue;
      items.push({
        kind: 'pending_shift',
        id: shift.id,
        localDate: shift.local_date,
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        createdAt: shift.created_at,
        coverAskExpiresAt: shift.cover_ask_expires_at ?? null,
      });
    }
  }

  items.sort((a, b) => compareItems(a, b, nowMs));
  return items;
}

/**
 * §2.2's urgency ordering. Rank ascending; a lower number renders first.
 * Ranks 4/8/9 belong to kinds this build does not add (`terms_proposal`,
 * `reimbursement_owed`, `terms_ack`) and are deliberately left unassigned
 * here rather than reused, so a later slice's kind slots in at its spec'd
 * rank without renumbering every other kind.
 */
function sortKey(item: InboxItem, nowMs: number): number {
  if (item.kind === 'pending_shift') {
    const hoursUntilStart = (Date.parse(item.startsAt) - nowMs) / 3_600_000;
    return hoursUntilStart <= 48 ? 1 : 5;
  }
  switch (item.kind) {
    case 'change_request':
      return 2;
    case 'queried_week':
      return 3;
    // Not in §2.2's table (patterns predate this build) — bucketed with
    // "pending_shift, all others": both are a schedule response waiting on
    // her, neither D-22-deadline-bearing.
    case 'pending_pattern':
      return 5;
    case 'submitted_week':
      return 6;
    case 'stale_submitted_week':
      return 7;
  }
}

/** The date each kind's copy is "about", for the ordering's soonest-first tie-break. */
function sortDateFor(item: InboxItem): string | null {
  switch (item.kind) {
    case 'pending_shift':
      return item.startsAt;
    case 'pending_pattern':
      return item.dtstart;
    case 'queried_week':
    case 'submitted_week':
    case 'stale_submitted_week':
      return item.weekStart;
    // change_request carries no date on this shape — insertion order stands
    // (a stable sort's fallback), which is an acceptable tie-break: two
    // change requests competing for the same rank is rare, and neither one
    // decays faster than the other in a way this shape can see.
    case 'change_request':
      return null;
  }
}

function compareItems(a: InboxItem, b: InboxItem, nowMs: number): number {
  const rankDiff = sortKey(a, nowMs) - sortKey(b, nowMs);
  if (rankDiff !== 0) return rankDiff;
  const dateA = sortDateFor(a);
  const dateB = sortDateFor(b);
  if (dateA && dateB) return Date.parse(dateA) - Date.parse(dateB);
  return 0;
}

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
 */

import { isParentEditorRole, type SetupRole } from '@/src/domains/setup/types';

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
  changeRequests: readonly InboxChangeRequestInput[];
  patterns: readonly InboxPatternInput[];
  timesheets: readonly InboxTimesheetInput[];
}): InboxItem[] {
  const me = input.currentUserId ?? null;
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

  return items;
}

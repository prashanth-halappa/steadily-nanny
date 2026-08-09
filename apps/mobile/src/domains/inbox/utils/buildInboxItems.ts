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
    };

export function buildInboxItems(input: {
  role: SetupRole | null;
  currentUserId: string | null | undefined;
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

  return items;
}

/**
 * @module domains/inbox/utils/buildInboxItems
 *
 * Pure aggregator for the pending-work inbox. Keeps filtering out of the
 * screen so each item type has a single, testable gate:
 *
 *  - change requests: pending AND opened by someone else (awaiting me)
 *  - co-parent approvals: parent/owner role AND pending AND not requested by me
 *  - pending patterns: status pending AND addressed to me as carer
 *  - queried weeks: status === 'queried' AND carer_id === me (not the parent
 *    who raised the query)
 */

import { isParentEditorRole, type SetupRole } from '@/src/domains/setup/types';

export type InboxChangeRequestInput = {
  id: string;
  shift_id: string;
  requested_by: string | null;
  kind: string;
  status: string;
};

export type InboxApprovalInput = {
  id: string;
  action: string;
  status: string;
  requested_by: string | null;
  timeout_at: string;
  payload: Record<string, unknown>;
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
};

export type InboxItem =
  | {
      kind: 'change_request';
      id: string;
      shiftId: string;
      requestKind: string;
    }
  | {
      kind: 'co_parent_approval';
      id: string;
      action: string;
      timeoutAt: string;
      shiftId?: string;
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
    };

function shiftIdFromPayload(
  payload: Record<string, unknown>
): string | undefined {
  const raw = payload.shift_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

export function buildInboxItems(input: {
  role: SetupRole | null;
  currentUserId: string | null | undefined;
  changeRequests: readonly InboxChangeRequestInput[];
  approvals: readonly InboxApprovalInput[];
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

  // Co-parent approvals are a parent/owner surface — nannies must never see
  // (or fetch) them. GET /approvals is parent-gated server-side.
  if (isParentEditorRole(input.role)) {
    for (const approval of input.approvals) {
      if (approval.status !== 'pending') continue;
      if (!me || approval.requested_by === me) continue;
      items.push({
        kind: 'co_parent_approval',
        id: approval.id,
        action: approval.action,
        timeoutAt: approval.timeout_at,
        shiftId: shiftIdFromPayload(approval.payload),
      });
    }
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

  return items;
}

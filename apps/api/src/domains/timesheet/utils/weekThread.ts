/**
 * THE WEEK THREAD, stored (D-18 / D-19 / D-46 —
 * `docs/design/attention-and-notifications.md` §3).
 *
 * There is no `timesheet_thread_messages` table and there should not be one.
 * `shift_events` (migration 015) is already an append-only log with a free-text
 * `event_type`, a nullable `shift_id` for day-level facts, a household-scoped
 * RLS read policy, and — the part that matters most for a dispute record — NO
 * update and NO delete policy anywhere. A new table would have had to re-earn
 * all four, and 1-E already writes `timesheet_queried` there. So a thread
 * message is a `shift_events` row keyed on
 * `(household_id, local_date = week_start, shift_id = null)` with the
 * timesheet id in the payload.
 *
 * TWO CARERS SHARE A WEEK START. `listForHouseholdDate` is keyed on
 * `(household_id, local_date)`, which in a two-nanny household is BOTH their
 * weeks — so `payload.timesheetId` is a required filter here, not a
 * nicety. Same class of bug as F-B1-3 (a week is identified by
 * `(household_id, carer_id, week_start)`, never by the week alone).
 *
 * AUTHORS ARE NAMED, NEVER ROLED (§3): "Priya", "The Ahmeds" — never "Carer"
 * or "Parent". The carer's name comes from the timesheet's own snapshotted
 * `carer_display_name`, so it survives her profile being deleted (033) with no
 * extra query; everyone else resolves to the household's name, which is what
 * the spec's own worked example shows. Rendering "You" for the reader's own
 * messages is the CLIENT's job — it has the viewer id and this does not.
 *
 * @module domains/timesheet/utils/weekThread
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type {
  TimesheetThreadMessage,
  TimesheetThreadMessageKind,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { TIMESHEET_THREAD_MESSAGE_KINDS } from '@steadily-nanny/shared-types/schemas/timesheet.schema';

/**
 * `shift_events.event_type` → wire kind, and the whitelist in one object.
 *
 * `timesheet_reopened` is deliberately absent: an undo-approve is a fact about
 * the week's STATE (and `WeekTotal` already captions it), not something
 * anybody said. The thread stays a conversation.
 */
export const TIMESHEET_THREAD_EVENT_TYPES: Record<
  string,
  TimesheetThreadMessageKind
> = {
  timesheet_queried: TIMESHEET_THREAD_MESSAGE_KINDS.QUERIED,
  timesheet_note_added: TIMESHEET_THREAD_MESSAGE_KINDS.NOTE,
  timesheet_query_withdrawn: TIMESHEET_THREAD_MESSAGE_KINDS.QUERY_WITHDRAWN,
};

/** The `event_type` a thread message is appended as. */
export const TIMESHEET_NOTE_ADDED_EVENT = 'timesheet_note_added';
export const TIMESHEET_QUERY_WITHDRAWN_EVENT = 'timesheet_query_withdrawn';

/**
 * Fallback author label when a household has never been named. Not "Parent" —
 * §3's naming rule holds even here; this is a name-shaped stand-in, not a role.
 */
const UNNAMED_HOUSEHOLD_LABEL = 'The family';

export interface ThreadContext {
  timesheetId: string;
  /** The week's carer, whose messages get her own name. */
  carerId: string | null;
  /** The timesheet's snapshotted `carer_display_name`. */
  carerName: string;
  householdName: string | null | undefined;
}

/**
 * WHICH SIDE WROTE IT — derived from the KIND, never from comparing two ids
 * that may both be gone (033).
 *
 * `query` and `withdrawQuery` are owner/parent-only writes
 * (`timesheetCommandService`), so `timesheet_queried` and
 * `timesheet_query_withdrawn` are the household's by construction. Only
 * `timesheet_note_added` can come from either side, and only there does the
 * actor id get a say.
 *
 * That last comparison is deliberately NOT guarded on `actor_id !== null`.
 * When the carer deletes her account, `shift_events.actor_id` and the
 * timesheet's `carer_id` BOTH go NULL together — so `null === null` is
 * precisely the case that identifies her, and the guard that used to sit
 * there re-labelled every word she ever wrote with the family's name, leaving
 * a pay dispute that reads as the family arguing with itself.
 *
 * ponytail: a note from a parent who ALSO deleted their account, on a week
 * whose carer left too, lands on her side — both ids are null and nothing
 * remaining distinguishes them. The alternative (assume the household) loses
 * the nanny's half of a dispute, which is the failure that matters.
 */
function isCarerAuthored(
  kind: TimesheetThreadMessageKind,
  actorId: string | null,
  carerId: string | null
): boolean {
  if (kind !== TIMESHEET_THREAD_MESSAGE_KINDS.NOTE) return false;
  return actorId === carerId;
}

/** Where each kind keeps its text. `query_withdrawn` has none, by design. */
function bodyOf(
  kind: TimesheetThreadMessageKind,
  payload: Record<string, unknown>
): string | null {
  if (kind === TIMESHEET_THREAD_MESSAGE_KINDS.QUERY_WITHDRAWN) return '';
  const field =
    kind === TIMESHEET_THREAD_MESSAGE_KINDS.QUERIED ? 'note' : 'message';
  const value = payload[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Day-thread rows → the messages both sides read, oldest first.
 *
 * A row whose text is missing is DROPPED rather than rendered blank: for a
 * query and a reply the text IS the message, and an empty bubble with a name
 * and a timestamp on it is a worse record than no bubble at all.
 */
export function toThreadMessages(
  events: readonly ShiftEvent[],
  context: ThreadContext
): TimesheetThreadMessage[] {
  const householdName =
    context.householdName?.trim() || UNNAMED_HOUSEHOLD_LABEL;
  const messages: TimesheetThreadMessage[] = [];

  for (const event of events) {
    const kind = TIMESHEET_THREAD_EVENT_TYPES[event.event_type];
    if (!kind) continue;

    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (payload.timesheetId !== context.timesheetId) continue;

    const body = bodyOf(kind, payload);
    if (body === null) continue;

    messages.push({
      id: event.id,
      kind,
      author_id: event.actor_id,
      author_name: isCarerAuthored(kind, event.actor_id, context.carerId)
        ? context.carerName
        : householdName,
      body,
      created_at: event.created_at,
    });
  }

  return messages;
}

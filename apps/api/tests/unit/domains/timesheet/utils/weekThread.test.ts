/**
 * The pure half of the week thread (D-18 / D-46,
 * `docs/design/attention-and-notifications.md` §3): turning raw `shift_events`
 * rows into the messages both sides read.
 *
 * WHAT IS PINNED HERE
 *  1. Only the three THREAD event types become messages. The day thread for a
 *     week_start Monday also carries real shift events (`shift_confirmed`,
 *     `timesheet_reopened`, …) and none of them are things anyone SAID.
 *  2. Rows are filtered by `payload.timesheetId`. Two carers in one household
 *     share a `week_start`, so their two threads share a `local_date` — the
 *     day-thread key alone would cross-render one nanny's dispute into the
 *     other's week.
 *  3. Authors are NAMED, never roled (§3): the week's carer resolves to the
 *     timesheet's snapshotted `carer_display_name`, anyone else to the
 *     household's name.
 *  4. Order is chronological and is the record — no "superseded" label, the
 *     order already says it (D-19).
 *  5. A `query_withdrawn` message carries an EMPTY body: it has no text, and
 *     the client renders the sentence in the reader's own language.
 */
import { describe, expect, it } from 'bun:test';
import { TIMESHEET_THREAD_MESSAGE_KINDS } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { toThreadMessages } from '../../../../../src/domains/timesheet/utils/weekThread';

const DAY_MS = 24 * 60 * 60 * 1000;
const queriedInstant = new Date(Date.now() - 14 * DAY_MS);
queriedInstant.setUTCHours(17, 4, 0, 0);
const THREAD_QUERIED_AT = queriedInstant
  .toISOString()
  .replace('.000Z', '+00:00');
const THREAD_REPLY_AT = new Date(
  queriedInstant.getTime() + (2 * 60 + 16) * 60 * 1000
).toISOString();
const THREAD_WITHDRAWN_AT = new Date(
  queriedInstant.getTime() + (14 * 60 + 56) * 60 * 1000
)
  .toISOString()
  .replace('.000Z', '+00:00');
const THREAD_REQUERY_AT = new Date(
  queriedInstant.getTime() + (39 * 60 + 56) * 60 * 1000
).toISOString();

// GOLDEN-FIXES #25: timestamps appear in BOTH serialisations across these
// fixtures — Postgres hands back `+00:00`, every hand-written fixture in this
// repo used to say `.000Z`, and a parser that only ever saw one is a parser
// that breaks in production.
const queriedEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  household_id: 'h1',
  shift_id: null,
  local_date: '2026-08-03',
  actor_id: 'parent-1',
  event_type: 'timesheet_queried',
  payload: {
    timesheetId: 'ts1',
    weekStart: '2026-08-03',
    note: 'Thursday looks about 90 minutes long — can you check?',
  },
  created_at: THREAD_QUERIED_AT,
};

const replyEvent = {
  id: '22222222-2222-4222-8222-222222222222',
  household_id: 'h1',
  shift_id: null,
  local_date: '2026-08-03',
  actor_id: 'carer-1',
  event_type: 'timesheet_note_added',
  payload: {
    timesheetId: 'ts1',
    weekStart: '2026-08-03',
    message: "I stayed late — Ayla's pickup ran over. I've fixed Thursday.",
  },
  created_at: THREAD_REPLY_AT,
};

const withdrawnEvent = {
  id: '33333333-3333-4333-8333-333333333333',
  household_id: 'h1',
  shift_id: null,
  local_date: '2026-08-03',
  actor_id: 'parent-1',
  event_type: 'timesheet_query_withdrawn',
  payload: { timesheetId: 'ts1', weekStart: '2026-08-03' },
  created_at: THREAD_WITHDRAWN_AT,
};

const context = {
  timesheetId: 'ts1',
  carerId: 'carer-1',
  carerName: 'Priya Nair',
  householdName: 'The Ahmeds',
};

describe('toThreadMessages', () => {
  it('renders a query, a reply and a withdrawal in chronological order', () => {
    const messages = toThreadMessages(
      [queriedEvent, replyEvent, withdrawnEvent] as never,
      context
    );

    expect(messages).toEqual([
      {
        id: queriedEvent.id,
        kind: TIMESHEET_THREAD_MESSAGE_KINDS.QUERIED,
        author_id: 'parent-1',
        author_name: 'The Ahmeds',
        body: 'Thursday looks about 90 minutes long — can you check?',
        created_at: THREAD_QUERIED_AT,
      },
      {
        id: replyEvent.id,
        kind: TIMESHEET_THREAD_MESSAGE_KINDS.NOTE,
        author_id: 'carer-1',
        author_name: 'Priya Nair',
        body: "I stayed late — Ayla's pickup ran over. I've fixed Thursday.",
        created_at: THREAD_REPLY_AT,
      },
      {
        id: withdrawnEvent.id,
        kind: TIMESHEET_THREAD_MESSAGE_KINDS.QUERY_WITHDRAWN,
        author_id: 'parent-1',
        author_name: 'The Ahmeds',
        body: '',
        created_at: THREAD_WITHDRAWN_AT,
      },
    ]);
  });

  it('drops day-thread events that are not part of the conversation', () => {
    const messages = toThreadMessages(
      [
        {
          ...queriedEvent,
          id: '44444444-4444-4444-8444-444444444444',
          event_type: 'timesheet_reopened',
          payload: { timesheetId: 'ts1', reason: 'wrong total' },
        },
        {
          ...queriedEvent,
          id: '55555555-5555-4555-8555-555555555555',
          event_type: 'shift_confirmed',
          payload: {},
        },
        queriedEvent,
      ] as never,
      context
    );

    expect(messages.map(m => m.id)).toEqual([queriedEvent.id]);
  });

  it('drops thread events belonging to a DIFFERENT timesheet on the same date', () => {
    const otherCarersReply = {
      ...replyEvent,
      id: '66666666-6666-4666-8666-666666666666',
      actor_id: 'carer-2',
      payload: {
        timesheetId: 'ts2',
        weekStart: '2026-08-03',
        message: 'my week, not hers',
      },
    };

    const messages = toThreadMessages(
      [queriedEvent, otherCarersReply] as never,
      context
    );

    expect(messages.map(m => m.id)).toEqual([queriedEvent.id]);
  });

  it('names a re-query with its own text rather than superseding the first (D-19)', () => {
    const reQuery = {
      ...queriedEvent,
      id: '77777777-7777-4777-8777-777777777777',
      created_at: THREAD_REQUERY_AT,
      payload: { ...queriedEvent.payload, note: 'And Friday too, sorry.' },
    };

    const messages = toThreadMessages(
      [queriedEvent, withdrawnEvent, reQuery] as never,
      context
    );

    expect(messages.map(m => m.body)).toEqual([
      'Thursday looks about 90 minutes long — can you check?',
      '',
      'And Friday too, sorry.',
    ]);
  });

  it('keeps a null actor readable after account deletion (033)', () => {
    const messages = toThreadMessages(
      [{ ...replyEvent, actor_id: null }] as never,
      context
    );

    expect(messages[0]?.author_id).toBeNull();
    expect(messages[0]?.author_name).toBe('The Ahmeds');
  });

  it('skips a thread event with no text where text is the whole message', () => {
    const messages = toThreadMessages(
      [{ ...replyEvent, payload: { timesheetId: 'ts1' } }] as never,
      context
    );

    expect(messages).toEqual([]);
  });
});

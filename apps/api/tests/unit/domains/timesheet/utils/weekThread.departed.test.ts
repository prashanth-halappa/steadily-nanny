/**
 * THE DISPUTE MUST KEEP TWO SIDES AFTER SHE LEAVES (033).
 *
 * Once the carer deletes her account, `shift_events.actor_id` on everything
 * she wrote goes NULL and the timesheet's `carer_id` goes NULL with it. The
 * old author test compared those two nulls with an `actor_id !== null` guard
 * in front, so it answered "not the carer" for EVERY message — and a pay
 * dispute rendered with the household's name on both halves. A record where
 * the family appears to have argued with itself is worse than no record.
 *
 * The side a message came from is a property of the EVENT KIND, not of an id
 * that no longer exists: `query` and `withdrawQuery` are owner/parent-only
 * writes (see `timesheetCommandService`), so they are always the household's.
 * Only `timesheet_note_added` can come from either side.
 */
import { describe, expect, it } from 'bun:test';
import { toThreadMessages } from '../../../../../src/domains/timesheet/utils/weekThread';

const AT = '2026-08-04T17:04:00+00:00';

function event(over: Record<string, unknown> = {}): any {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    household_id: 'h1',
    shift_id: null,
    local_date: '2026-08-03',
    actor_id: 'parent-1',
    event_type: 'timesheet_note_added',
    payload: { timesheetId: 'ts1', weekStart: '2026-08-03', message: 'hi' },
    created_at: AT,
    ...over,
  };
}

/** Her account is gone: the timesheet keeps her name, nothing keeps her id. */
const DEPARTED_CONTEXT = {
  timesheetId: 'ts1',
  carerId: null,
  carerName: 'Emma Clarke',
  householdName: 'The Ahmeds',
};

describe('toThreadMessages — after the carer deleted her account (033)', () => {
  it('keeps her replies under HER name, not the household’s', () => {
    const messages = toThreadMessages(
      [
        event({
          id: '22222222-2222-4222-8222-222222222222',
          actor_id: null,
          payload: {
            timesheetId: 'ts1',
            weekStart: '2026-08-03',
            message: 'Thursday ran over — Ayla’s pickup.',
          },
        }),
      ],
      DEPARTED_CONTEXT
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.author_name).toBe('Emma Clarke');
  });

  it('still names the household on a query, even when the parent’s id is gone too', () => {
    // `query` is an owner/parent-only write. A parent who has since deleted
    // their own account leaves the SAME null actor_id — and comparing nulls
    // would hand her question to her.
    const messages = toThreadMessages(
      [
        event({
          actor_id: null,
          event_type: 'timesheet_queried',
          payload: {
            timesheetId: 'ts1',
            weekStart: '2026-08-03',
            note: 'Thursday looks about 90 minutes long — can you check?',
          },
        }),
        event({
          id: '33333333-3333-4333-8333-333333333333',
          actor_id: null,
          event_type: 'timesheet_query_withdrawn',
          payload: { timesheetId: 'ts1', weekStart: '2026-08-03' },
        }),
      ],
      DEPARTED_CONTEXT
    );

    expect(messages.map(m => m.author_name)).toEqual([
      'The Ahmeds',
      'The Ahmeds',
    ]);
  });

  it('renders a two-sided dispute as two sides', () => {
    const messages = toThreadMessages(
      [
        event({
          actor_id: null,
          event_type: 'timesheet_queried',
          payload: {
            timesheetId: 'ts1',
            weekStart: '2026-08-03',
            note: 'Thursday looks long.',
          },
        }),
        event({
          id: '44444444-4444-4444-8444-444444444444',
          actor_id: null,
          payload: {
            timesheetId: 'ts1',
            weekStart: '2026-08-03',
            message: 'I stayed late.',
          },
        }),
      ],
      DEPARTED_CONTEXT
    );

    expect(messages.map(m => m.author_name)).toEqual([
      'The Ahmeds',
      'Emma Clarke',
    ]);
  });

  it('a parent’s note on a departed carer’s week is still the household’s', () => {
    const messages = toThreadMessages([event({ actor_id: 'parent-1' })], {
      ...DEPARTED_CONTEXT,
    });

    expect(messages[0]?.author_name).toBe('The Ahmeds');
  });

  it('a live carer’s query is STILL the household’s, not hers', () => {
    // Regression guard on the kind-based rule: a live carer can never be the
    // author of a `timesheet_queried` row, whatever actor_id happens to say.
    const messages = toThreadMessages(
      [
        event({
          actor_id: 'carer-1',
          event_type: 'timesheet_queried',
          payload: {
            timesheetId: 'ts1',
            weekStart: '2026-08-03',
            note: 'Thursday looks long.',
          },
        }),
      ],
      {
        timesheetId: 'ts1',
        carerId: 'carer-1',
        carerName: 'Marisol Reyes',
        householdName: 'The Ahmeds',
      }
    );

    expect(messages[0]?.author_name).toBe('The Ahmeds');
  });
});

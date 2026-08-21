/**
 * P3 — the server's recorded cause reaches the sentence.
 *
 * `inferUncoveredCauseDetail` can only ever infer `cancelled`/`declined`/
 * `nothingScheduled` from shift rows, so `closureRemoved` and `needsAdded`
 * — which the API DOES record on `shift_events.payload.cause` — were
 * unreachable copy. These lock in that a day-thread event supplies them and
 * that a window with no event still falls back exactly as before.
 *
 * @module domains/schedule/utils/__tests__/uncoveredDisplay.serverCause.test
 */
import { describe, expect, it } from 'bun:test';
import type {
  Shift,
  ShiftEvent,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import { inferUncoveredCauseDetail } from '../uncoveredDisplay';

const CHILD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const window: UncoveredWindow = {
  childId: CHILD,
  commitmentId: COMMITMENT,
  startsAt: '2026-03-23T10:00:00.000Z',
  endsAt: '2026-03-23T12:00:00.000Z',
};

function makeEvent(
  payload: Record<string, unknown>,
  createdAt = '2026-03-22T09:00:00.000Z'
): ShiftEvent {
  return {
    id: `e-${createdAt}`,
    household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
    shift_id: null,
    local_date: '2026-03-23',
    actor_id: null,
    event_type: 'uncovered_care',
    payload,
    created_at: createdAt,
  } as ShiftEvent;
}

function uncoveredEvent(cause: string, createdAt?: string): ShiftEvent {
  return makeEvent(
    {
      key: `${CHILD}|${COMMITMENT}|${window.startsAt}`,
      child_id: CHILD,
      commitment_id: COMMITMENT,
      starts_at: window.startsAt,
      ends_at: window.endsAt,
      cause,
    },
    createdAt
  );
}

function makeShift(status: Shift['status']): Shift {
  return {
    id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
    carer_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    created_by: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
    kind: 'recurring',
    status,
    origin: 'system_generated',
    starts_at: '2026-03-23T09:00:00.000Z',
    ends_at: '2026-03-23T17:00:00.000Z',
    timezone: 'UTC',
    local_date: '2026-03-23',
    is_short_notice: false,
    source_pattern_id: null,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift@test',
    sequence: 0,
    shift_children: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as Shift;
}

describe('inferUncoveredCauseDetail with a server cause', () => {
  it('reports closureRemoved when the day thread says so', () => {
    expect(
      inferUncoveredCauseDetail(window, [], [uncoveredEvent('closureRemoved')])
    ).toEqual({ cause: 'closureRemoved', shift: null });
  });

  it('reports needsAdded when the day thread says so', () => {
    expect(
      inferUncoveredCauseDetail(window, [], [uncoveredEvent('needsAdded')])
    ).toEqual({ cause: 'needsAdded', shift: null });
  });

  it('falls back to nothingScheduled with no matching event', () => {
    expect(inferUncoveredCauseDetail(window, [], [])).toEqual({
      cause: 'nothingScheduled',
      shift: null,
    });
  });

  it('ignores an event for a different child', () => {
    const other = makeEvent({
      child_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      commitment_id: COMMITMENT,
      starts_at: window.startsAt,
      ends_at: window.endsAt,
      cause: 'closureRemoved',
    });
    expect(inferUncoveredCauseDetail(window, [], [other]).cause).toBe(
      'nothingScheduled'
    );
  });

  it('ignores an event that does not overlap the window', () => {
    const other = makeEvent({
      child_id: CHILD,
      commitment_id: COMMITMENT,
      starts_at: '2026-03-23T14:00:00.000Z',
      ends_at: '2026-03-23T16:00:00.000Z',
      cause: 'needsAdded',
    });
    expect(inferUncoveredCauseDetail(window, [], [other]).cause).toBe(
      'nothingScheduled'
    );
  });

  it('takes the most recent matching event', () => {
    expect(
      inferUncoveredCauseDetail(
        window,
        [],
        [
          uncoveredEvent('needsAdded', '2026-03-20T09:00:00.000Z'),
          uncoveredEvent('closureRemoved', '2026-03-22T09:00:00.000Z'),
        ]
      ).cause
    ).toBe('closureRemoved');
  });

  it('never throws on a malformed payload', () => {
    const junk = makeEvent({ child_id: 42, cause: { nope: true } });
    expect(inferUncoveredCauseDetail(window, [], [junk]).cause).toBe(
      'nothingScheduled'
    );
  });

  it('ignores an unrecognised cause string', () => {
    expect(
      inferUncoveredCauseDetail(window, [], [uncoveredEvent('☃')]).cause
    ).toBe('nothingScheduled');
  });

  it('ignores a non-uncovered_care event', () => {
    const running = makeEvent({ cause: 'closureRemoved', child_id: CHILD });
    running.event_type = 'running_late';
    expect(inferUncoveredCauseDetail(window, [], [running]).cause).toBe(
      'nothingScheduled'
    );
  });

  it('still prefers the named cancelled shift over a stale server cause', () => {
    const detail = inferUncoveredCauseDetail(
      window,
      [makeShift('cancelled')],
      [uncoveredEvent('closureRemoved')]
    );
    expect(detail.cause).toBe('cancelled');
    expect(detail.shift).not.toBeNull();
  });
});

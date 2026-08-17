/**
 * @module domains/schedule/__tests__/patternPrecedence.test
 *
 * `resolveActivePattern` — which of a household's schedule patterns the
 * Schedule tab's banner speaks for. The Schedule tab used to take
 * `.find(p => p.status !== 'ended')`, so whichever non-ended row the API
 * happened to return first won: a household holding a stale `withdrawn`
 * row plus a freshly-sent `pending` one rendered "You withdrew your usual
 * week" while a week was genuinely sitting with the nanny.
 */
import { describe, expect, it } from 'bun:test';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { resolveActivePattern } from '../utils/patternPrecedence';

function makePattern(
  status: string,
  createdAt = '2026-08-01T00:00:00.000Z',
  id = `p-${status}-${createdAt}`
): SchedulePattern {
  return {
    id,
    household_id: '11111111-1111-4111-8111-111111111111',
    carer_id: null,
    status,
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    dtstart: '2026-08-05',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: null,
    decline_message: null,
    created_by: null,
    sent_at: null,
    responded_at: null,
    ical_uid: 'uid',
    sequence: 0,
    created_at: createdAt,
    updated_at: createdAt,
  } as SchedulePattern;
}

describe('resolveActivePattern', () => {
  it('returns null for an empty list', () => {
    expect(resolveActivePattern([])).toBeNull();
  });

  // The reported bug, in one assertion: a stale withdrawn row must never
  // outrank a week that is actually with the nanny right now, whatever
  // order the list arrives in.
  it('REGRESSION: pending beats an earlier-listed withdrawn row', () => {
    const withdrawn = makePattern('withdrawn', '2026-08-10T00:00:00.000Z');
    const pending = makePattern('pending', '2026-08-01T00:00:00.000Z');

    expect(resolveActivePattern([withdrawn, pending])?.status).toBe('pending');
    expect(resolveActivePattern([pending, withdrawn])?.status).toBe('pending');
  });

  it.each([
    ['pending over accepted', ['accepted', 'pending'], 'pending'],
    ['accepted over draft', ['draft', 'accepted'], 'accepted'],
    ['draft over declined', ['declined', 'draft'], 'draft'],
    ['declined over withdrawn', ['withdrawn', 'declined'], 'declined'],
    ['withdrawn over ended', ['ended', 'withdrawn'], 'withdrawn'],
  ])('%s', (_label, statuses, expected) => {
    const patterns = statuses.map(s => makePattern(s as never));
    expect(resolveActivePattern(patterns)?.status).toBe(expected as never);
    expect(resolveActivePattern([...patterns].reverse())?.status).toBe(
      expected as never
    );
  });

  // `ended` used to be filtered out entirely, so a household whose week had
  // run its course fell through to the "no usual week yet" copy. It is a
  // real state now — the banner says "has ended".
  it('returns an ended pattern rather than null when it is all there is', () => {
    const ended = makePattern('ended');
    expect(resolveActivePattern([ended])).toBe(ended);
  });

  it('breaks ties on the same status by most recent created_at', () => {
    const older = makePattern('draft', '2026-07-01T00:00:00.000Z', 'older');
    const newer = makePattern('draft', '2026-08-14T09:30:00.000Z', 'newer');

    expect(resolveActivePattern([older, newer])?.id).toBe('newer');
    expect(resolveActivePattern([newer, older])?.id).toBe('newer');
  });

  it('sorts an unknown status last and never throws', () => {
    const bogus = makePattern('teleported' as never);
    const ended = makePattern('ended');

    expect(resolveActivePattern([bogus, ended])?.status).toBe('ended');
    expect(resolveActivePattern([bogus])?.status).toBe('teleported' as never);
  });

  it('tolerates a row with no status at all', () => {
    const noStatus = { ...makePattern('draft'), status: undefined } as never;
    const draft = makePattern('draft');

    expect(() => resolveActivePattern([noStatus, draft])).not.toThrow();
    expect(resolveActivePattern([noStatus, draft])).toBe(draft);
  });
});

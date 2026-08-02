/**
 * @module tests/unit/scripts/levelBRoundtripHelpers.test
 * Pure helpers pulled out of scripts/level-b-roundtrip.ts's G4 (concurrent
 * accept serialisation) step, so the race-outcome logic can be unit tested
 * without a live Supabase project. The script itself only exercises these
 * against real HTTP/DB responses — see the script's own header for what
 * remains unverified outside a live testbed.
 */
import { describe, expect, it } from 'bun:test';
import {
  type ChangeRequestOutcomeRow,
  eventsMatchRaceOutcome,
  isSingleWinnerRace,
  pickRaceWinner,
  type ShiftEventRow,
} from '../../../scripts/lib/levelBRoundtripHelpers';

describe('isSingleWinnerRace', () => {
  it('is true for one 2xx and one 409, in either order', () => {
    expect(isSingleWinnerRace(200, 409)).toBe(true);
    expect(isSingleWinnerRace(409, 200)).toBe(true);
    expect(isSingleWinnerRace(201, 409)).toBe(true);
  });

  it('is false when both succeed (double-accept bug)', () => {
    expect(isSingleWinnerRace(200, 200)).toBe(false);
  });

  it('is false when both are rejected', () => {
    expect(isSingleWinnerRace(409, 409)).toBe(false);
  });

  it('is false for an unexpected status on either side', () => {
    expect(isSingleWinnerRace(200, 500)).toBe(false);
    expect(isSingleWinnerRace(404, 409)).toBe(false);
  });
});

describe('pickRaceWinner', () => {
  it('picks the accepted row as winner and the superseded row as loser', () => {
    const rows: ChangeRequestOutcomeRow[] = [
      { id: 'a', status: 'accepted' },
      { id: 'b', status: 'superseded' },
    ];
    expect(pickRaceWinner(rows)).toEqual({ winnerId: 'a', loserId: 'b' });
  });

  it('works regardless of row order', () => {
    const rows: ChangeRequestOutcomeRow[] = [
      { id: 'b', status: 'superseded' },
      { id: 'a', status: 'accepted' },
    ];
    expect(pickRaceWinner(rows)).toEqual({ winnerId: 'a', loserId: 'b' });
  });

  it('returns null when both are still pending (race did not resolve)', () => {
    const rows: ChangeRequestOutcomeRow[] = [
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'pending' },
    ];
    expect(pickRaceWinner(rows)).toBeNull();
  });

  it('returns null when both ended up accepted (double-accept bug)', () => {
    const rows: ChangeRequestOutcomeRow[] = [
      { id: 'a', status: 'accepted' },
      { id: 'b', status: 'accepted' },
    ];
    expect(pickRaceWinner(rows)).toBeNull();
  });

  it('returns null for anything other than exactly two rows', () => {
    expect(pickRaceWinner([{ id: 'a', status: 'accepted' }])).toBeNull();
    expect(pickRaceWinner([])).toBeNull();
  });
});

describe('eventsMatchRaceOutcome', () => {
  const winner = { winnerId: 'win-id', loserId: 'lose-id' };

  it('is true when accepted + shift_updated + superseded events all match the outcome', () => {
    const events: ShiftEventRow[] = [
      {
        event_type: 'change_request_accepted',
        payload: { change_request_id: 'win-id' },
      },
      {
        event_type: 'shift_updated',
        payload: { change_request_id: 'win-id' },
      },
      {
        event_type: 'change_request_superseded',
        payload: { change_request_id: 'lose-id', superseded_by: 'win-id' },
      },
    ];
    expect(eventsMatchRaceOutcome(events, winner)).toBe(true);
  });

  it('is false when the accept event is missing (029 crash-safety regression)', () => {
    const events: ShiftEventRow[] = [
      {
        event_type: 'shift_updated',
        payload: { change_request_id: 'win-id' },
      },
      {
        event_type: 'change_request_superseded',
        payload: { change_request_id: 'lose-id', superseded_by: 'win-id' },
      },
    ];
    expect(eventsMatchRaceOutcome(events, winner)).toBe(false);
  });

  it('is false when the superseded event names the wrong winner', () => {
    const events: ShiftEventRow[] = [
      {
        event_type: 'change_request_accepted',
        payload: { change_request_id: 'win-id' },
      },
      {
        event_type: 'shift_updated',
        payload: { change_request_id: 'win-id' },
      },
      {
        event_type: 'change_request_superseded',
        payload: {
          change_request_id: 'lose-id',
          superseded_by: 'someone-else',
        },
      },
    ];
    expect(eventsMatchRaceOutcome(events, winner)).toBe(false);
  });

  it('is false when there are duplicate accepted events (non-atomic write)', () => {
    const events: ShiftEventRow[] = [
      {
        event_type: 'change_request_accepted',
        payload: { change_request_id: 'win-id' },
      },
      {
        event_type: 'change_request_accepted',
        payload: { change_request_id: 'win-id' },
      },
      {
        event_type: 'shift_updated',
        payload: { change_request_id: 'win-id' },
      },
      {
        event_type: 'change_request_superseded',
        payload: { change_request_id: 'lose-id', superseded_by: 'win-id' },
      },
    ];
    expect(eventsMatchRaceOutcome(events, winner)).toBe(false);
  });
});

/**
 * Pure helpers for scripts/level-b-roundtrip.ts's G4 step (concurrent accept
 * serialisation, migrations 024/028/029). Pulled out so the race-outcome
 * logic is unit-testable without a live Supabase project — the script itself
 * is the only thing that can exercise these against real HTTP/DB responses.
 *
 * @module scripts/lib/levelBRoundtripHelpers
 */

/**
 * Classifies a concurrent pair of HTTP response statuses from two racing
 * `respond` (accept) calls against the same shift's competing change
 * requests. Under migrations 024/029's row-lock serialisation, exactly one
 * call wins (2xx) and the other loses because the DB-level CAS in
 * `accept_shift_change_request` already flipped it to non-pending (409) —
 * any other combination (both 2xx, both 409, or an unexpected status) means
 * the serialisation broke.
 */
export function isSingleWinnerRace(statusA: number, statusB: number): boolean {
  const [lower, upper] = [statusA, statusB].sort((a, b) => a - b);
  return (lower ?? 0) >= 200 && (lower ?? 0) < 300 && upper === 409;
}

export interface ChangeRequestOutcomeRow {
  id: string;
  status: string;
}

export interface RaceWinner {
  winnerId: string;
  loserId: string;
}

/**
 * From the two change-request rows after a concurrent accept race, picks out
 * which one won (status 'accepted') and which lost (status 'superseded').
 * Returns null unless the DB state is exactly one of each — anything else
 * (both still pending, both accepted, etc.) signals the race was not
 * resolved correctly.
 */
export function pickRaceWinner(
  rows: ChangeRequestOutcomeRow[]
): RaceWinner | null {
  if (rows.length !== 2) {
    return null;
  }
  const accepted = rows.filter(r => r.status === 'accepted');
  const superseded = rows.filter(r => r.status === 'superseded');
  if (accepted.length !== 1 || superseded.length !== 1) {
    return null;
  }
  const winner = accepted[0];
  const loser = superseded[0];
  if (!winner || !loser) {
    return null;
  }
  return { winnerId: winner.id, loserId: loser.id };
}

export interface ShiftEventRow {
  event_type: string;
  payload: Record<string, unknown>;
}

/**
 * Verifies the day-thread events left behind by `accept_shift_change_request`
 * (migration 029) are atomic and consistent with the race's outcome: exactly
 * one `change_request_accepted` and one `shift_updated` event naming the
 * winner, and exactly one `change_request_superseded` event naming the loser
 * and pointing `superseded_by` at the winner. This is what actually proves
 * migration 029's whole purpose — that the accept's mutation and its
 * day-thread events land atomically — rather than just checking the
 * `shift_change_requests` row statuses.
 */
export function eventsMatchRaceOutcome(
  events: ShiftEventRow[],
  { winnerId, loserId }: RaceWinner
): boolean {
  const accepted = events.filter(
    e =>
      e.event_type === 'change_request_accepted' &&
      e.payload.change_request_id === winnerId
  );
  const updated = events.filter(
    e =>
      e.event_type === 'shift_updated' &&
      e.payload.change_request_id === winnerId
  );
  const superseded = events.filter(
    e =>
      e.event_type === 'change_request_superseded' &&
      e.payload.change_request_id === loserId &&
      e.payload.superseded_by === winnerId
  );
  return (
    accepted.length === 1 && updated.length === 1 && superseded.length === 1
  );
}

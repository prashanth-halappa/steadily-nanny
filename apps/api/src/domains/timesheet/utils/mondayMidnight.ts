/**
 * The week boundary as an INSTANT, not a calendar date.
 *
 * `weekStart.ts` answers "which week does this belong to", which is a pure
 * calendar question and needs no offset. Splitting a session that runs across
 * Sunday night needs the other half of the answer: the exact UTC moment the
 * household's own week turns over. That moment moves with the zone's offset —
 * midnight in London is 00:00Z in winter and 23:00Z the evening before in
 * summer — so a UTC-midnight assumption misfiles a whole hour of pay into the
 * wrong week's timesheet twice a year.
 *
 * Dependency-free, like its sibling: `Intl.DateTimeFormat` is the only
 * timezone database in this codebase (see `weekStart.ts`).
 *
 * @module domains/timesheet/utils/mondayMidnight
 */
import { weekEndExclusive, weekStartOf } from './weekStart';

/**
 * `timeZone`'s offset from UTC, in ms, at the instant `utcMs` — positive east
 * of Greenwich. Derived by formatting the instant in that zone and reading
 * the wall-clock fields back as if they were UTC; the difference IS the
 * offset, and it comes from the same tzdata `Intl` uses everywhere else.
 */
function offsetMsAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const field = (type: string): number =>
    Number(parts.find(part => part.type === type)?.value ?? '0');

  const wallMs = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second')
  );
  return wallMs - utcMs;
}

/**
 * The UTC instant at which the local week containing `afterInstant` ENDS —
 * i.e. the following household-local Monday, 00:00.
 *
 * Two probes rather than one: the offset has to be sampled at an instant, and
 * the instant is what we are solving for. Sampling at the naive guess and
 * correcting is exact everywhere the offset is stable across that one-offset
 * distance, and the second probe catches the case where the guess landed on
 * the far side of a transition. If a zone ever shifts its clocks exactly at
 * midnight (so local midnight does not exist that night), the result is the
 * instant the clock jumps to — an hour late, but real, ordered and unique,
 * which is all the split arithmetic needs.
 */
export function mondayMidnightInstant(
  afterInstant: Date,
  timeZone: string
): Date {
  const nextMonday = weekEndExclusive(weekStartOf(afterInstant, timeZone));
  const naive = Date.parse(`${nextMonday}T00:00:00.000Z`);

  const firstGuess = naive - offsetMsAt(naive, timeZone);
  const refined = naive - offsetMsAt(firstGuess, timeZone);
  return new Date(refined);
}

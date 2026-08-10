/**
 * @module domains/today/utils/heroMood
 *
 * Which spot illustration the Today hero band shows (screens-today.md §6).
 * Three states, one rule each, and `here` always wins — while someone is on
 * the clock the day's shape is settled whatever the other rows say.
 *
 * `done` is deliberately strict: EVERY cover row for today has to have
 * finished. One carer still due this afternoon means the day is not over, so
 * an evening-light illustration would be a small lie about the schedule.
 * Both roles read the same household rows — a nanny's own shifts are among
 * them, so "her shifts are all in the past" falls out of the same test.
 */
import type { IllustrationKey } from '@/assets/illustrations';
import type { CoverKind } from '../hooks/useTodayCoverRows';

export type HeroMood = 'here' | 'done' | 'quiet';

export const HERO_MOOD_ILLUSTRATION: Record<HeroMood, IllustrationKey> = {
  here: 'todayHere',
  done: 'todayDone',
  quiet: 'todayQuiet',
};

export function resolveHeroMood(input: {
  isLive: boolean;
  rows: readonly { kind: CoverKind }[];
}): HeroMood {
  if (input.isLive || input.rows.some(row => row.kind === 'live')) {
    return 'here';
  }
  if (
    input.rows.length > 0 &&
    input.rows.every(row => row.kind === 'finished')
  ) {
    return 'done';
  }
  return 'quiet';
}

/**
 * @module domains/today/__tests__/heroMood.test
 * The hero band's spot illustration is state-driven, not wallpaper.
 */
import { describe, expect, it } from 'bun:test';
import type { CoverKind } from '../hooks/useTodayCoverRows';
import { HERO_MOOD_ILLUSTRATION, resolveHeroMood } from '../utils/heroMood';

function rows(...kinds: CoverKind[]) {
  return kinds.map(kind => ({ kind }));
}

describe('resolveHeroMood', () => {
  it('is quiet with no cover rows at all', () => {
    expect(resolveHeroMood({ isLive: false, rows: [] })).toBe('quiet');
  });

  it('is here while the household is live, even with no rows yet', () => {
    expect(resolveHeroMood({ isLive: true, rows: [] })).toBe('here');
  });

  it('is here on a live row even when useHouseholdIsLive has not caught up', () => {
    expect(resolveHeroMood({ isLive: false, rows: rows('live') })).toBe('here');
  });

  it('is done only when every row for today has finished', () => {
    expect(
      resolveHeroMood({ isLive: false, rows: rows('finished', 'finished') })
    ).toBe('done');
  });

  it('is quiet, not done, while anyone is still due today', () => {
    expect(
      resolveHeroMood({ isLive: false, rows: rows('finished', 'scheduled') })
    ).toBe('quiet');
    expect(
      resolveHeroMood({ isLive: false, rows: rows('finished', 'arriving') })
    ).toBe('quiet');
  });

  it('a live row beats a finished one — the day is not over', () => {
    expect(
      resolveHeroMood({ isLive: false, rows: rows('finished', 'live') })
    ).toBe('here');
  });

  it('maps each mood to its own illustration', () => {
    expect(HERO_MOOD_ILLUSTRATION.here).toBe('todayHere');
    expect(HERO_MOOD_ILLUSTRATION.done).toBe('todayDone');
    expect(HERO_MOOD_ILLUSTRATION.quiet).toBe('todayQuiet');
  });
});

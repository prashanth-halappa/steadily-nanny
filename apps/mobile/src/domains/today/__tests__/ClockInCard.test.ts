/**
 * @module domains/today/__tests__/ClockInCard.test
 *
 * Source-inspection test (Pattern A, docs/09-TESTING.md §5) — the card pulls
 * in the query/mutation hooks and the loading-button's Reanimated internals,
 * so we assert architectural markers instead of rendering. Covers the
 * required testIDs, the "location is reassurance never a gate" rule (no
 * permission check, no schedule-window gate on clock-in), and the
 * NativeWind-on-Animated.View gotcha (GOLDEN-FIXES #2) not applying because
 * no Animated.View is used here at all.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const cardPath = join(__dirname, '../components/ClockInCard.tsx');
let cardSource: string;

beforeAll(async () => {
  cardSource = await Bun.file(cardPath).text();
});

describe('ClockInCard', () => {
  it('wires the required testIDs', () => {
    expect(cardSource).toContain('today-clock-in');
    expect(cardSource).toContain('today-clock-out');
    expect(cardSource).toContain('today-live-timer');
  });

  it('never gates clock-in on a location permission', () => {
    expect(cardSource).not.toMatch(/requestForegroundPermissions|Location\./);
  });

  it('never disables clock-in based on the scheduled shift window', () => {
    expect(cardSource).not.toMatch(/isWithinSchedule|scheduledWindow/);
  });

  it('uses the live-timer hook rather than a bare setInterval inline', () => {
    expect(cardSource).toContain('useElapsedTimer');
    expect(cardSource).not.toMatch(/setInterval\(/);
  });

  it('does not use an Animated.View for the timer (no className gotcha to avoid)', () => {
    expect(cardSource).not.toMatch(/<Animated\.View/);
  });
});

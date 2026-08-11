/**
 * @module domains/today/__tests__/gapEscalation.test
 *
 * §5.4 / D-47 — the gap card's T−12h self-escalation, tested as the pure
 * clock function it is. There is no push, no job and no server state behind
 * this: the only input is `startsAt` and the current instant, which is why it
 * can be pinned here without rendering anything.
 */
import { describe, expect, it } from 'bun:test';
import { gapEscalationHours } from '../hooks/useTodayCoverage';

const NOW = Date.parse('2026-08-11T09:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;

describe('gapEscalationHours (§5.4 self-escalation)', () => {
  it('returns the whole-hour countdown inside the 12h threshold', () => {
    expect(gapEscalationHours(at(9 * HOUR), NOW)).toBe(9);
    expect(gapEscalationHours(at(1 * HOUR), NOW)).toBe(1);
  });

  it('is null at and beyond 12 hours — the card keeps its normal headline', () => {
    expect(gapEscalationHours(at(12 * HOUR), NOW)).toBeNull();
    expect(gapEscalationHours(at(12 * HOUR + 1), NOW)).toBeNull();
    expect(gapEscalationHours(at(11 * HOUR + 59 * 60_000), NOW)).toBe(11);
  });

  it('never rounds up — it must not claim more time than there is', () => {
    // 9h40m left is "starts in 9 hours", not 10. Overstating the runway is
    // the one error direction that matters on a card whose whole job is to
    // say nobody is booked.
    expect(gapEscalationHours(at(9 * HOUR + 40 * 60_000), NOW)).toBe(9);
  });

  it('floors at 1 hour rather than showing 0 hours or minutes', () => {
    // Minutes are banned here (§5.4: "this is the only countdown in the
    // product; round to whole hours, never show minutes"), so the last hour
    // reads "in 1 hour" rather than counting down to zero.
    expect(gapEscalationHours(at(20 * 60_000), NOW)).toBe(1);
    expect(gapEscalationHours(at(1), NOW)).toBe(1);
  });

  it('is null once the window has started — nothing "starts in" the past', () => {
    expect(gapEscalationHours(at(0), NOW)).toBeNull();
    expect(gapEscalationHours(at(-HOUR), NOW)).toBeNull();
  });

  it('is null for an unparseable instant rather than rendering NaN hours', () => {
    expect(gapEscalationHours('not-a-date', NOW)).toBeNull();
  });
});

/**
 * @module domains/schedule/utils/__tests__/coverAskDeadline
 */
import { describe, expect, it } from 'bun:test';
import { COVER_ASK_URGENT_HOURS, isCoverAskUrgent } from '../coverAskDeadline';

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

describe('isCoverAskUrgent', () => {
  it('is false when the expiry is well beyond the urgent window', () => {
    expect(isCoverAskUrgent('2026-08-12T12:00:00.000Z', NOW)).toBe(false);
  });

  it('is true right at the urgent-window boundary', () => {
    const boundary = new Date(
      NOW + COVER_ASK_URGENT_HOURS * 60 * 60 * 1000
    ).toISOString();
    expect(isCoverAskUrgent(boundary, NOW)).toBe(true);
  });

  it('is true inside the urgent window', () => {
    expect(isCoverAskUrgent('2026-08-10T20:00:00.000Z', NOW)).toBe(true);
  });

  it('is false once the deadline has already passed — that is "expired", not "urgent"', () => {
    expect(isCoverAskUrgent('2026-08-10T11:00:00.000Z', NOW)).toBe(false);
  });

  it('is false for a null deadline', () => {
    expect(isCoverAskUrgent(null, NOW)).toBe(false);
  });
});

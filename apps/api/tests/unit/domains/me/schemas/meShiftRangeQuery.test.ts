/**
 * F-B7-3 — `MeShiftRangeQuerySchema`'s `to > from` was a string compare, the
 * twin of the shift domain's three. GOLDEN-FIXES #25: one instant has many
 * spellings, and text order is not instant order.
 */
import { describe, expect, it } from 'bun:test';
import { MeShiftRangeQuerySchema } from '../../../../../src/domains/me/schemas';

describe('MeShiftRangeQuerySchema — instant compare (F-B7-3)', () => {
  it('rejects a range that is inverted by instant but ordered as text', () => {
    expect(
      MeShiftRangeQuerySchema.safeParse({
        from: '2026-08-03T11:00:00-01:00', // 12:00Z
        to: '2026-08-03T11:30:00+00:00', // 11:30Z
      }).success
    ).toBe(false);
  });

  it('accepts a range that is ordered by instant but inverted as text', () => {
    expect(
      MeShiftRangeQuerySchema.safeParse({
        from: '2026-08-03T11:00:00+00:00', // 11:00Z
        to: '2026-08-03T10:30:00-02:00', // 12:30Z
      }).success
    ).toBe(true);
  });

  it('rejects the same instant spelled two ways as a zero-length range', () => {
    expect(
      MeShiftRangeQuerySchema.safeParse({
        from: '2026-08-03T08:00:00+00:00',
        to: '2026-08-03T08:00:00.000Z',
      }).success
    ).toBe(false);
  });

  it('accepts an ordinary same-offset range', () => {
    expect(
      MeShiftRangeQuerySchema.safeParse({
        from: '2026-08-03T00:00:00.000Z',
        to: '2026-08-10T00:00:00.000Z',
      }).success
    ).toBe(true);
  });
});

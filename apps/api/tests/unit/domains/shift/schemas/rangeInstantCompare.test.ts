/**
 * F-B7-3 — the three shift-domain "end after start" refines compared ISO
 * strings with `>`, which is only the instant order while both sides carry
 * the same offset and the same number of fractional digits. GOLDEN-FIXES #25:
 * one instant has many spellings, and text order is not instant order.
 */
import { describe, expect, it } from 'bun:test';
import {
  CreateExtraShiftSchema,
  ParentEditShiftSchema,
  ShiftRangeQuerySchema,
} from '../../../../../src/domains/shift/schemas';

/**
 * `to`/`ends_at` is 11:30Z, `from`/`starts_at` is 12:00Z — an inverted range.
 * Lexicographically the reverse is true (`11:30…` sorts after `11:00…`), so a
 * string compare waves it through.
 */
const INSTANT_INVERTED = {
  start: '2026-08-03T11:00:00-01:00', // 12:00Z
  end: '2026-08-03T11:30:00+00:00', // 11:30Z
};

/** The mirror: 11:00Z → 12:30Z, a valid range a string compare rejects. */
const INSTANT_ORDERED = {
  start: '2026-08-03T11:00:00+00:00', // 11:00Z
  end: '2026-08-03T10:30:00-02:00', // 12:30Z
};

/** The same instant twice, spelled two ways — a zero-length range. */
const SAME_INSTANT = {
  start: '2026-08-03T08:00:00+00:00',
  end: '2026-08-03T08:00:00.000Z',
};

describe('ShiftRangeQuerySchema — instant compare (F-B7-3)', () => {
  it('rejects a range that is inverted by instant but ordered as text', () => {
    expect(
      ShiftRangeQuerySchema.safeParse({
        from: INSTANT_INVERTED.start,
        to: INSTANT_INVERTED.end,
      }).success
    ).toBe(false);
  });

  it('accepts a range that is ordered by instant but inverted as text', () => {
    expect(
      ShiftRangeQuerySchema.safeParse({
        from: INSTANT_ORDERED.start,
        to: INSTANT_ORDERED.end,
      }).success
    ).toBe(true);
  });

  it('rejects the same instant spelled two ways as a zero-length range', () => {
    expect(
      ShiftRangeQuerySchema.safeParse({
        from: SAME_INSTANT.start,
        to: SAME_INSTANT.end,
      }).success
    ).toBe(false);
  });
});

describe('ParentEditShiftSchema — instant compare (F-B7-3)', () => {
  it('rejects a shift that is inverted by instant but ordered as text', () => {
    expect(
      ParentEditShiftSchema.safeParse({
        starts_at: INSTANT_INVERTED.start,
        ends_at: INSTANT_INVERTED.end,
      }).success
    ).toBe(false);
  });

  it('accepts a shift that is ordered by instant but inverted as text', () => {
    expect(
      ParentEditShiftSchema.safeParse({
        starts_at: INSTANT_ORDERED.start,
        ends_at: INSTANT_ORDERED.end,
      }).success
    ).toBe(true);
  });

  it('rejects the same instant spelled two ways as a zero-length shift', () => {
    expect(
      ParentEditShiftSchema.safeParse({
        starts_at: SAME_INSTANT.start,
        ends_at: SAME_INSTANT.end,
      }).success
    ).toBe(false);
  });

  // The refine stays optional-guarded: this endpoint's whole point is that a
  // note-only or one-sided edit is legal.
  it('still accepts a one-sided edit with only ends_at', () => {
    expect(
      ParentEditShiftSchema.safeParse({ ends_at: INSTANT_ORDERED.end }).success
    ).toBe(true);
  });

  it('still accepts a note-only edit', () => {
    expect(
      ParentEditShiftSchema.safeParse({ note: 'running late' }).success
    ).toBe(true);
  });
});

describe('CreateExtraShiftSchema — instant compare (F-B7-3)', () => {
  const base = { timezone: 'Europe/London' };

  it('rejects a shift that is inverted by instant but ordered as text', () => {
    expect(
      CreateExtraShiftSchema.safeParse({
        ...base,
        starts_at: INSTANT_INVERTED.start,
        ends_at: INSTANT_INVERTED.end,
      }).success
    ).toBe(false);
  });

  it('accepts a shift that is ordered by instant but inverted as text', () => {
    expect(
      CreateExtraShiftSchema.safeParse({
        ...base,
        starts_at: INSTANT_ORDERED.start,
        ends_at: INSTANT_ORDERED.end,
      }).success
    ).toBe(true);
  });

  it('rejects the same instant spelled two ways as a zero-length shift', () => {
    expect(
      CreateExtraShiftSchema.safeParse({
        ...base,
        starts_at: SAME_INSTANT.start,
        ends_at: SAME_INSTANT.end,
      }).success
    ).toBe(false);
  });
});

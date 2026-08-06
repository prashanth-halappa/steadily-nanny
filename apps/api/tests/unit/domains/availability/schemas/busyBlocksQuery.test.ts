/**
 * F-B7-4 — `BusyBlocksQuerySchema` validated the shape of `from`/`to` but
 * never their order, so a fully inverted range reached the repository. Its
 * three sibling range queries all refine; this one was the gap.
 */
import { describe, expect, it } from 'bun:test';
import { BusyBlocksQuerySchema } from '../../../../../src/domains/availability/schemas';

describe('BusyBlocksQuerySchema — range refine (F-B7-4)', () => {
  it('rejects a plainly inverted range', () => {
    expect(
      BusyBlocksQuerySchema.safeParse({
        from: '2026-08-10T00:00:00.000Z',
        to: '2026-08-03T00:00:00.000Z',
      }).success
    ).toBe(false);
  });

  // GOLDEN-FIXES #25 — the refine has to be an instant compare, not the
  // string compare its siblings shipped with.
  it('rejects a range that is inverted by instant but ordered as text', () => {
    expect(
      BusyBlocksQuerySchema.safeParse({
        from: '2026-08-03T11:00:00-01:00', // 12:00Z
        to: '2026-08-03T11:30:00+00:00', // 11:30Z
      }).success
    ).toBe(false);
  });

  it('accepts a range that is ordered by instant but inverted as text', () => {
    expect(
      BusyBlocksQuerySchema.safeParse({
        from: '2026-08-03T11:00:00+00:00', // 11:00Z
        to: '2026-08-03T10:30:00-02:00', // 12:30Z
      }).success
    ).toBe(true);
  });

  it('rejects the same instant spelled two ways as a zero-length range', () => {
    expect(
      BusyBlocksQuerySchema.safeParse({
        from: '2026-08-03T08:00:00+00:00',
        to: '2026-08-03T08:00:00.000Z',
      }).success
    ).toBe(false);
  });

  it('accepts an ordinary same-offset range', () => {
    expect(
      BusyBlocksQuerySchema.safeParse({
        from: '2026-08-03T00:00:00.000Z',
        to: '2026-08-10T00:00:00.000Z',
      }).success
    ).toBe(true);
  });
});

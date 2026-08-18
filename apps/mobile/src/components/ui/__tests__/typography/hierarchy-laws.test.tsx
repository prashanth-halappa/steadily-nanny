/**
 * Guards for the two hierarchy laws that the shipped app violated.
 *
 * 1. Weight is non-decreasing with importance. `h1` shipped at 600 while `h3`
 *    (20) and `figure` (28) sat at 700, so the largest text in the ramp was the
 *    lightest heading in it — which is what "the screen title reads small"
 *    actually was.
 * 2. Daylight separates by light, not by rule. `H2` carried a `border-b`
 *    inherited from the previous (Ledger) direction, which is why nothing used
 *    it and every screen jumped 32 -> 20 -> 16 with no section rung.
 */

import { describe, expect, it } from 'bun:test';
import { typography } from '@/lib/design-tokens/typography';

describe('weight monotonicity', () => {
  it('h1 is at least as heavy as every token allowed beneath it in a hero band', () => {
    const h1 = Number(typography.h1.weight);
    for (const token of [
      typography.h2,
      typography.h3,
      typography.h4,
      typography.figure,
      typography.dayGroup,
      typography.body,
    ]) {
      expect(h1).toBeGreaterThanOrEqual(Number(token.weight));
    }
  });

  it('h1 is the largest of the heading rungs', () => {
    expect(typography.h1.size).toBeGreaterThan(typography.h2.size);
    expect(typography.h2.size).toBeGreaterThan(typography.h3.size);
    expect(typography.h3.size).toBeGreaterThan(typography.h4.size);
  });

  it('the section rung outweighs the body it heads', () => {
    expect(Number(typography.dayGroup.weight)).toBeGreaterThan(
      Number(typography.body.weight)
    );
    expect(typography.dayGroup.size).toBeGreaterThan(typography.body.size);
  });
});

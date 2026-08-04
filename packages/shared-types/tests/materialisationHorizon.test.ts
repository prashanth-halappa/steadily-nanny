/**
 * @module packages/shared-types — materialisation horizon invariants
 */
import { describe, expect, it } from 'bun:test';
import {
  MATERIALISATION_HORIZON_DAYS,
  MATERIALISATION_HORIZON_WEEKS,
} from '../src/constants';

describe('materialisation horizon', () => {
  it('keeps days and weeks in agreement (12 × 7 = 84)', () => {
    expect(MATERIALISATION_HORIZON_WEEKS * 7).toBe(
      MATERIALISATION_HORIZON_DAYS
    );
  });
});

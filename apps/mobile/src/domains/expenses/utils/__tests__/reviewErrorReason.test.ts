/**
 * @module domains/expenses/utils/__tests__/reviewErrorReason.test
 * Extracts the typed `metadata.reason` off an `ExpenseValidationError`
 * response (TIER0-CX-SPEC.md §6.2's "Set a mileage rate before approving
 * mileage" arm) without ever touching the generic `errorLocalization`
 * table, which has no notion of this domain-specific reason code.
 */
import { describe, expect, it } from 'bun:test';
import { reviewErrorReason } from '../reviewErrorReason';

describe('reviewErrorReason', () => {
  it('extracts NO_MILEAGE_RATE from an axios-shaped error', () => {
    const error = {
      response: {
        status: 400,
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            metadata: { reason: 'NO_MILEAGE_RATE' },
          },
        },
      },
    };
    expect(reviewErrorReason(error)).toBe('NO_MILEAGE_RATE');
  });

  it('returns null for an error with no metadata', () => {
    expect(reviewErrorReason(new Error('network down'))).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(reviewErrorReason(null)).toBeNull();
    expect(reviewErrorReason(undefined)).toBeNull();
  });

  it('returns null when reason is not a string', () => {
    const error = {
      response: { data: { error: { metadata: { reason: 42 } } } },
    };
    expect(reviewErrorReason(error)).toBeNull();
  });
});

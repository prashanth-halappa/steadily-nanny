import { describe, expect, it } from 'bun:test';
import { ERROR_CODES } from '../src/errorCodes';

const EXPECTED_CODES = [
  'CONFLICT',
  'EXTERNAL_SERVICE_ERROR',
  'FORBIDDEN',
  'INTERNAL_ERROR',
  'NOT_FOUND',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'VALIDATION_ERROR',
];

describe('ERROR_CODES', () => {
  it('exposes exactly the generic code set', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual([...EXPECTED_CODES].sort());
  });

  it('maps each code to its own name', () => {
    // key is `string`, value is the literal union; assert on the wider side so
    // the comparison stays type-clean (strict equality is symmetric).
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(key).toBe(value);
    }
  });
});

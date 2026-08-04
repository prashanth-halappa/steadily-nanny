/**
 * @module domains/schedule/__tests__/extraShiftForm.test
 */
import { describe, expect, it } from 'bun:test';
import {
  isExtraShiftFormValid,
  isValidHhmm,
  isValidIsoDate,
} from '../utils/extraShiftForm';

describe('extraShiftForm validation', () => {
  it('accepts a well-formed one-off shift', () => {
    expect(
      isExtraShiftFormValid({
        date: '2026-08-10',
        start: '09:00',
        end: '17:00',
        carerId: 'carer-1',
      })
    ).toBe(true);
  });

  it('rejects malformed dates and times so submit stays disabled', () => {
    expect(isValidIsoDate('10 Aug')).toBe(false);
    expect(isValidHhmm('9am')).toBe(false);
    expect(
      isExtraShiftFormValid({
        date: '2026-08-10',
        start: '9am',
        end: '17:00',
        carerId: 'carer-1',
      })
    ).toBe(false);
  });

  it('rejects end before start and missing carer', () => {
    expect(
      isExtraShiftFormValid({
        date: '2026-08-10',
        start: '17:00',
        end: '09:00',
        carerId: 'carer-1',
      })
    ).toBe(false);
    expect(
      isExtraShiftFormValid({
        date: '2026-08-10',
        start: '09:00',
        end: '17:00',
        carerId: null,
      })
    ).toBe(false);
  });
});

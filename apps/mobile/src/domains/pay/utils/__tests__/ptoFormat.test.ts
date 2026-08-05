/**
 * @module domains/pay/utils/__tests__/ptoFormat
 * A negative balance is legal (docs/11-MONEY.md §5) and must render
 * honestly, never clamped to zero.
 */
import { describe, expect, it } from 'bun:test';
import { formatSignedHours } from '../ptoFormat';

describe('formatSignedHours', () => {
  it('formats a positive whole-hour balance', () => {
    expect(formatSignedHours(5760)).toBe('96h');
  });

  it('formats a negative balance with a leading minus — never clamped to zero', () => {
    expect(formatSignedHours(-480)).toBe('-8h');
  });

  it('formats a value with leftover minutes', () => {
    expect(formatSignedHours(-510)).toBe('-8h 30m');
    expect(formatSignedHours(90)).toBe('1h 30m');
  });

  it('zero renders as "0h", not blank', () => {
    expect(formatSignedHours(0)).toBe('0h');
  });
});

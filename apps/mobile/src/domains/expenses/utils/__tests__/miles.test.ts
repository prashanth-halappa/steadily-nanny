/**
 * @module domains/expenses/utils/__tests__/miles.test
 * `parseMilesInput` mirrors `lib/money.ts`'s `parseMajorToMinor` discipline
 * (return `null`, never guess) for the ONE-decimal-place miles field —
 * `expense.schema.ts`'s `MilesSchema` backs a `numeric(6,1)` column, so a
 * value with more than one decimal must be refused client-side with a clear
 * message rather than silently truncated or bounced off the server.
 */
import { describe, expect, it } from 'bun:test';
import { parseMilesInput } from '../miles';

describe('parseMilesInput', () => {
  it('parses a whole number', () => {
    expect(parseMilesInput('12')).toBe(12);
  });

  it('parses one decimal place', () => {
    expect(parseMilesInput('12.4')).toBe(12.4);
  });

  it('returns null for more than one decimal place', () => {
    expect(parseMilesInput('12.45')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseMilesInput('0')).toBeNull();
  });

  it('returns null for a negative value', () => {
    expect(parseMilesInput('-1.2')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(parseMilesInput('')).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseMilesInput('abc')).toBeNull();
  });

  it('returns null for trailing junk', () => {
    expect(parseMilesInput('12.4mi')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(parseMilesInput('  12.4  ')).toBe(12.4);
  });
});

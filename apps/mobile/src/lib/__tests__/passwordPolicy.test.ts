import { describe, expect, it } from 'bun:test';
import { isPasswordTooShort, PASSWORD_MIN_LENGTH } from '../passwordPolicy';

describe('passwordPolicy', () => {
  it('matches Supabase’s default minimum (supabase/config.toml sets none)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(6);
  });

  it('rejects anything shorter than the minimum', () => {
    expect(isPasswordTooShort('')).toBe(true);
    expect(isPasswordTooShort('12345')).toBe(true);
  });

  it('accepts the minimum and above', () => {
    expect(isPasswordTooShort('123456')).toBe(false);
    expect(isPasswordTooShort('a-longer-one')).toBe(false);
  });
});

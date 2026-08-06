import { describe, expect, it } from 'bun:test';
import { getLocalizedAuthErrorMessage } from '../errorLocalization';

const t = (key: string) => `t:${key}`;

describe('getLocalizedAuthErrorMessage', () => {
  it('maps invalid login credentials', () => {
    expect(
      getLocalizedAuthErrorMessage({ message: 'Invalid login credentials' }, t)
    ).toBe('t:auth:errors.invalidCredentials');
  });

  it('maps rate-limit messages', () => {
    expect(
      getLocalizedAuthErrorMessage(
        {
          message:
            'For security purposes, you can only request this after 51 seconds.',
        },
        t
      )
    ).toBe('t:auth:errors.rateLimited');
  });

  // Supabase rejects a short password with 422 "Password should be at least 6
  // characters." — the most common signup failure there is. Mapped to real copy
  // instead of "An unknown error occurred", which tells the user nothing.
  it('maps a too-short password by message', () => {
    expect(
      getLocalizedAuthErrorMessage(
        { message: 'Password should be at least 6 characters.' },
        t
      )
    ).toBe('t:auth:errors.passwordTooShort');
  });

  it('maps a too-short password by supabase error code', () => {
    expect(
      getLocalizedAuthErrorMessage(
        { code: 'weak_password', message: 'Password is too weak' },
        t
      )
    ).toBe('t:auth:errors.passwordTooShort');
  });

  it('falls back to auth unknown rather than raw message', () => {
    expect(
      getLocalizedAuthErrorMessage(
        { message: 'Some obscure supabase string' },
        t
      )
    ).toBe('t:auth:errors.unknown');
  });
});

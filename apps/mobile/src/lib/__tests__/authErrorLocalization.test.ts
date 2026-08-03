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

  it('falls back to auth unknown rather than raw message', () => {
    expect(
      getLocalizedAuthErrorMessage(
        { message: 'Some obscure supabase string' },
        t
      )
    ).toBe('t:auth:errors.unknown');
  });
});

import { describe, expect, it } from 'bun:test';
import { getLocalizedAuthErrorMessage } from '../errorLocalization';

const t = (key: string) => `t:${key}`;
const map = (error: unknown) => getLocalizedAuthErrorMessage(error, t);

describe('getLocalizedAuthErrorMessage (Better Auth codes)', () => {
  it('maps invalid credentials', () => {
    expect(map({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 })).toBe(
      't:auth:errors.invalidCredentials'
    );
  });

  // The most common sign-up failure. Mapped to real copy instead of "An
  // unknown error occurred", which tells the user nothing.
  it('maps a too-short password', () => {
    expect(map({ code: 'PASSWORD_TOO_SHORT', status: 400 })).toBe(
      't:auth:errors.passwordTooShort'
    );
  });

  it('maps an existing account', () => {
    expect(map({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' })).toBe(
      't:auth:errors.emailTaken'
    );
  });

  it('maps an unverified email', () => {
    expect(map({ code: 'EMAIL_NOT_VERIFIED', status: 403 })).toBe(
      't:auth:errors.emailNotConfirmed'
    );
  });

  it('maps a spent reset token', () => {
    expect(map({ code: 'INVALID_TOKEN', status: 400 })).toBe(
      't:auth:errors.resetLinkInvalid'
    );
  });

  it('maps a 429 to rate limited', () => {
    expect(map({ status: 429, message: 'Too many requests' })).toBe(
      't:auth:errors.rateLimited'
    );
  });

  it('maps a fetch failure to network', () => {
    expect(map(new TypeError('Network request failed'))).toBe(
      't:errors:network'
    );
  });

  it('falls back to auth unknown rather than the raw message', () => {
    expect(map({ code: 'SOMETHING_NEW', message: 'Some obscure string' })).toBe(
      't:auth:errors.unknown'
    );
  });
});

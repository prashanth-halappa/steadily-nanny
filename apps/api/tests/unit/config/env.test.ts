import { describe, expect, test } from 'bun:test';
import { env, isProduction, isTest } from '../../../src/config/env';
import {
  coreEnvSchema,
  productionRequiredCoreKeys,
} from '../../../src/config/env.core';

const SECRET = 'x'.repeat(32);

describe('env.core schema', () => {
  test('fails fast when BETTER_AUTH_SECRET is missing', () => {
    expect(coreEnvSchema.safeParse({}).success).toBe(false);
  });

  test('rejects a BETTER_AUTH_SECRET shorter than 32 characters', () => {
    expect(
      coreEnvSchema.safeParse({ BETTER_AUTH_SECRET: 'short' }).success
    ).toBe(false);
  });

  test('parses with only BETTER_AUTH_SECRET set (no legacy database vars)', () => {
    expect(
      coreEnvSchema.safeParse({ BETTER_AUTH_SECRET: SECRET }).success
    ).toBe(true);
  });

  test('treats an empty-string SENTRY_DSN as unset, not an invalid URL (D2: verbatim .env.example ships SENTRY_DSN=)', () => {
    const result = coreEnvSchema.safeParse({
      BETTER_AUTH_SECRET: SECRET,
      SENTRY_DSN: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRY_DSN).toBeUndefined();
    }
  });

  test('applies defaults for PORT and BETTER_AUTH_URL; social ids stay optional', () => {
    const result = coreEnvSchema.safeParse({ BETTER_AUTH_SECRET: SECRET });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
      expect(result.data.BETTER_AUTH_URL).toBe('http://localhost:8080');
      expect(result.data.APPLE_CLIENT_ID).toBeUndefined();
      expect(result.data.GOOGLE_CLIENT_ID).toBeUndefined();
    }
  });

  test('production-required keys include jobs + email secrets', () => {
    expect(productionRequiredCoreKeys).toContain('JOB_API_KEY');
    expect(productionRequiredCoreKeys).toContain('RESEND_API_KEY');
  });
});

describe('env test short-circuit', () => {
  test('returns hardcoded placeholders under NODE_ENV=test', () => {
    expect(isTest).toBe(true);
    expect(isProduction).toBe(false);
    expect(env.NODE_ENV).toBe('test');
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});

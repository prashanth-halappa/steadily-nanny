import { describe, expect, test } from 'bun:test';
import { env, isProduction, isTest } from '../../../src/config/env';
import {
  coreEnvSchema,
  productionRequiredCoreKeys,
} from '../../../src/config/env.core';

describe('env.core schema', () => {
  test('fails fast when a required var is missing', () => {
    const result = coreEnvSchema.safeParse({
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_KEY: 's',
      // SUPABASE_URL missing
    });
    expect(result.success).toBe(false);
  });

  test('treats an empty-string SENTRY_DSN as unset, not an invalid URL (D2: verbatim .env.example ships SENTRY_DSN=)', () => {
    const result = coreEnvSchema.safeParse({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_KEY: 's',
      SENTRY_DSN: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRY_DSN).toBeUndefined();
    }
  });

  test('applies defaults for PORT', () => {
    const result = coreEnvSchema.safeParse({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_KEY: 's',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
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
    expect(env.SUPABASE_URL).toBe('http://localhost:54321');
  });
});

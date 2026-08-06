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
      GOOGLE_VERTEX_PROJECT: 'p',
      // SUPABASE_URL missing
    });
    expect(result.success).toBe(false);
  });

  test('parses successfully without GOOGLE_VERTEX_PROJECT (F-B11-7: optional until an LLM call is actually made)', () => {
    const result = coreEnvSchema.safeParse({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_KEY: 's',
      // GOOGLE_VERTEX_PROJECT intentionally omitted
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GOOGLE_VERTEX_PROJECT).toBeUndefined();
    }
  });

  test('treats an empty-string GOOGLE_VERTEX_PROJECT as unset, not "too small" (D2: an empty env block value must not crash boot)', () => {
    const result = coreEnvSchema.safeParse({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_KEY: 's',
      GOOGLE_VERTEX_PROJECT: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GOOGLE_VERTEX_PROJECT).toBeUndefined();
    }
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

  test('applies defaults for PORT and GOOGLE_VERTEX_LOCATION', () => {
    const result = coreEnvSchema.safeParse({
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_KEY: 's',
      GOOGLE_VERTEX_PROJECT: 'p',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
      expect(result.data.GOOGLE_VERTEX_LOCATION).toBe('us-central1');
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
    expect(env.GOOGLE_VERTEX_PROJECT).toBe('test-vertex-project');
  });
});

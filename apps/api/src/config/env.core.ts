/**
 * Core environment schema (framework-level).
 *
 * These are the variables the reusable API core needs regardless of product:
 * server config, Supabase, the LLM provider (Vertex AI via ADC), monitoring,
 * jobs, and email.
 *
 * App-specific variables live in `app.env.ts` (the extension point). Both are
 * merged and validated once, fail-fast, in `env.ts`.
 *
 * @module config/env.core
 */
import { z } from 'zod';

/**
 * Required + optional core variables.
 *
 * Truly-required (no default) vars throw at boot if absent. Optional vars are
 * enforced only in production via `productionRequiredCoreKeys` (see env.ts).
 */
export const coreEnvSchema = z.object({
  // ── Server ────────────────────────────────────────────────────────────────
  PORT: z
    .string()
    .transform(val => Number.parseInt(val, 10))
    .pipe(z.number().min(1).max(65535))
    .default(8080),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // ── Supabase (required) ─────────────────────────────────────────────────────
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_KEY: z.string().min(1, 'SUPABASE_SERVICE_KEY is required'),

  // ── LLM via Vertex AI (optional at boot; required only once a call is made) ──
  // Auth is Application Default Credentials (ADC) — no API key in env.
  // No domain currently calls into `llmProvider` (see its module doc), so this
  // stays optional at boot — `llmProvider` throws a clear error naming this var
  // if it's unset when a model factory is actually invoked. Empty string (an
  // env block value left blank) is treated the same as unset — same trap as
  // SENTRY_DSN below.
  GOOGLE_VERTEX_PROJECT: z.preprocess(
    val => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  GOOGLE_VERTEX_LOCATION: z.string().min(1).default('us-central1'),

  // ── Monitoring (optional; production-recommended) ────────────────────────────
  // `.env.example` ships `SENTRY_DSN=` (empty) — bun loads that as "", which
  // z.string().url() rejects outright. Treat empty as unset so a verbatim
  // .env.example copy boots instead of hard-failing with "Invalid URL".
  SENTRY_DSN: z.preprocess(
    val => (val === '' ? undefined : val),
    z.string().url().optional()
  ),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ── Background jobs (optional; production-required) ──────────────────────────
  // Shared secret for the X-Job-Api-Key header on /api/jobs/* routes.
  JOB_API_KEY: z.string().optional(),

  // ── Email via Resend (optional; production-required) ─────────────────────────
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().default('steadilynanny <hello@nanny.getsteadily.app>'),
});

/** Core env variables inferred from the schema. */
export type CoreEnv = z.infer<typeof coreEnvSchema>;

/**
 * Optional core vars that MUST be present in production. `env.ts` throws if any
 * are missing when `NODE_ENV === 'production'`.
 */
export const productionRequiredCoreKeys = [
  'JOB_API_KEY',
  'RESEND_API_KEY',
] as const satisfies readonly (keyof CoreEnv)[];

/**
 * Placeholder values used in `NODE_ENV === 'test'` so unit tests boot without a
 * real `.env`. Mirrors the required core shape.
 */
export const coreTestEnv: CoreEnv = {
  PORT: 8080,
  NODE_ENV: 'test',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_KEY: 'test-service-key',
  GOOGLE_VERTEX_PROJECT: 'test-vertex-project',
  GOOGLE_VERTEX_LOCATION: 'us-central1',
  LOG_LEVEL: 'info',
  JOB_API_KEY: 'test-job-api-key',
  RESEND_API_KEY: 'test-resend-key',
  RESEND_WEBHOOK_SECRET: 'test-resend-webhook-secret',
  EMAIL_FROM: 'steadilynanny <hello@nanny.getsteadily.app>',
};

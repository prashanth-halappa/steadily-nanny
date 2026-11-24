/**
 * Core environment schema (framework-level).
 *
 * These are the variables the reusable API core needs regardless of product:
 * server config, auth (Better Auth), monitoring,
 * and jobs.
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

  // ── Better Auth (secret required) ────────────────────────────────────────────
  // Signs session cookies/tokens. Rotating it signs everyone out.
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  // Public origin of this API; the auth routes live under `${it}/api/auth`.
  BETTER_AUTH_URL: z.string().url().default('http://localhost:8080'),

  // ── Social sign-in (optional; a provider is enabled only when its id is set) ─
  // Apple: the Services ID (web flow, Android) and the iOS bundle id (native
  // flow). Both are accepted as the id-token audience.
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_APP_BUNDLE_IDENTIFIER: z.string().optional(),
  // Only the Android/web OAuth redirect flow needs this (a signed JWT made from
  // the .p8 key, max 6 months). Native iOS id-token sign-in works without it.
  APPLE_CLIENT_SECRET: z.string().optional(),
  // Google: the web client id (also Android's serverClientId) and the iOS
  // client id. Both are accepted as the id-token audience.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_IOS_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // ── Email/password auth (dev/test only — never set in production) ───────────
  // Fails closed: on only when exactly 'true'. Production signs in with
  // Apple/Google; seeders and Maestro use email users against `wrangler dev`.
  EMAIL_AUTH_ENABLED: z
    .string()
    .optional()
    .transform(val => val === 'true'),

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
});

/** Core env variables inferred from the schema. */
export type CoreEnv = z.infer<typeof coreEnvSchema>;

/**
 * Optional core vars that MUST be present in production. `env.ts` throws if any
 * are missing when `NODE_ENV === 'production'`.
 */
export const productionRequiredCoreKeys = [
  'JOB_API_KEY',
] as const satisfies readonly (keyof CoreEnv)[];

/**
 * Placeholder values used in `NODE_ENV === 'test'` so unit tests boot without a
 * real `.env`. Mirrors the required core shape.
 */
export const coreTestEnv: CoreEnv = {
  PORT: 8080,
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET: 'test-better-auth-secret-at-least-32-chars',
  BETTER_AUTH_URL: 'http://localhost:8080',
  LOG_LEVEL: 'info',
  JOB_API_KEY: 'test-job-api-key',
  // Unit tests sign users up over HTTP.
  EMAIL_AUTH_ENABLED: true,
};

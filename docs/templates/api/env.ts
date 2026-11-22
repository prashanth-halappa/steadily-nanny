/**
 * Environment Configuration Validation (skeleton)
 *
 * Validates all required environment variables at startup using Zod.
 * If any required variable is missing or invalid, the app fails fast with a
 * clear, formatted error before the server ever binds a port.
 *
 * Import this module FIRST in app.ts (`import './config/env';`) so validation
 * runs before any other module reads process.env.
 *
 * Mirrors apps/api/src/config/env.ts (which splits the schema into env.core.ts
 * + app.env.ts). NOTE: every value below is a placeholder. Never commit real secrets — those
 * come from the deployment environment / a gitignored .env file.
 */

import { z } from 'zod';

// No dotenv: Bun loads .env itself; on Workers, vars/secrets arrive in
// process.env via nodejs_compat (`wrangler dev` reads .dev.vars).

/**
 * Required variables — the API will NOT start without these.
 */
const requiredEnvSchema = z.object({
  // Server
  PORT: z
    .string()
    .transform(val => parseInt(val, 10))
    .pipe(z.number().min(1).max(65535))
    .default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Auth (Better Auth)
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url().default('http://localhost:8787'),
});

/**
 * Optional variables — sensible defaults, or only needed in certain envs.
 * Promote any of these to "required in production" in validateEnv() below.
 */
const optionalEnvSchema = z.object({
  // Social sign-in (Better Auth providers)
  APPLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Monitoring
  SENTRY_DSN: z.url().optional(),

  // Scheduled-job auth (the X-Job-Api-Key shared secret)
  JOB_API_KEY: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('app <hello@example.com>'),
});

// Zod 4: `.extend(shape)` (not the deprecated `.merge(otherSchema)`).
const envSchema = requiredEnvSchema.extend(optionalEnvSchema.shape);

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  // In test, skip validation and return a fully-populated stub so unit tests
  // can run without a real .env. Keep this in sync with the schema shape.
  if (process.env.NODE_ENV === 'test') {
    return {
      PORT: 8080,
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: 'test-better-auth-secret-at-least-32-chars',
      BETTER_AUTH_URL: 'http://localhost:8787',
      JOB_API_KEY: 'test-job-api-key',
      LOG_LEVEL: 'info',
      RESEND_API_KEY: 'test-resend-key',
      EMAIL_FROM: 'app <hello@example.com>',
    } as Env;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map(err => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');

    console.error('\n========================================');
    console.error('   ENVIRONMENT CONFIGURATION ERROR');
    console.error('========================================\n');
    console.error('The following environment variables are missing or invalid:\n');
    console.error(errors);
    console.error('\nCheck your .env file or deployment configuration.\n');

    throw new Error(`Environment validation failed:\n${errors}`);
  }

  // Enforce production-only required variables here, e.g.:
  if (process.env.NODE_ENV === 'production') {
    const missing = (['JOB_API_KEY', 'RESEND_API_KEY'] as const).filter(k => !result.data[k]);
    if (missing.length > 0) {
      throw new Error(`The following variables are required in production: ${missing.join(', ')}`);
    }
  }

  return result.data;
}

/** Single source of truth for validated env config. */
export const env = validateEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

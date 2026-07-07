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
 * NOTE: every value below is a placeholder. Never commit real secrets — those
 * come from the deployment environment / a gitignored .env file.
 */

import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env into process.env first (no-op in environments that inject vars).
dotenv.config();

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

  // Supabase
  SUPABASE_URL: z.url('SUPABASE_URL must be a valid URL'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_KEY: z.string().min(1, 'SUPABASE_SERVICE_KEY is required'),

  // LLM provider (Google Gemini via the Vercel AI SDK, through Vertex AI in this
  // stack — authenticated via Application Default Credentials, NOT an API key;
  // see 05-API-LLM-JOBS.md §1 and PROVISIONING.md §3)
  GOOGLE_VERTEX_PROJECT: z.string().min(1, 'GOOGLE_VERTEX_PROJECT is required'),
  GOOGLE_VERTEX_LOCATION: z.string().min(1).default('us-central1'),
});

/**
 * Optional variables — sensible defaults, or only needed in certain envs.
 * Promote any of these to "required in production" in validateEnv() below.
 */
const optionalEnvSchema = z.object({
  // Monitoring
  SENTRY_DSN: z.url().optional(),
  POSTHOG_API_KEY: z.string().optional(),

  // Scheduled-job auth (the X-Job-Api-Key shared secret)
  JOB_API_KEY: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_KEY: 'test-service-key',
      GOOGLE_VERTEX_PROJECT: 'test-gcp-project',
      GOOGLE_VERTEX_LOCATION: 'us-central1',
      JOB_API_KEY: 'test-job-api-key',
      LOG_LEVEL: 'info',
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
    if (!result.data.JOB_API_KEY) {
      throw new Error('JOB_API_KEY is required in production');
    }
    // if (!result.data.SENTRY_DSN) throw new Error('SENTRY_DSN required in production');
  }

  return result.data;
}

/** Single source of truth for validated env config. */
export const env = validateEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

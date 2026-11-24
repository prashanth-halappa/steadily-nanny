/**
 * Environment configuration validation (fail-fast at boot).
 *
 * Merges the core schema (`env.core.ts`) with the app-specific extension
 * (`app.env.ts`), validates `process.env` once with Zod, and throws a clear
 * error if anything required is missing. This module is imported FIRST in
 * `app.ts`, so a misconfigured deploy crashes at boot rather than on the first
 * request.
 *
 * Behaviors preserved from the source (and covered by tests):
 * - Fail-fast with a formatted error listing every missing/invalid var.
 * - Production-only enforcement of optional-but-required vars.
 * - Test short-circuit: `NODE_ENV === 'test'` returns hardcoded placeholders so
 *   unit tests run without a real `.env`.
 *
 * @module config/env
 */
import type { z } from 'zod';
import { appEnvSchema, appTestEnv, productionRequiredAppKeys } from './app.env';
import {
  coreEnvSchema,
  coreTestEnv,
  productionRequiredCoreKeys,
} from './env.core';

// No dotenv: Bun loads .env itself; on Workers vars/secrets arrive in process.env
// via nodejs_compat (`wrangler dev` reads .dev.vars).

// Zod 4 deprecates `.merge()`; `.extend()` with the other schema's shape is the
// supported way to combine two object schemas.
const envSchema = coreEnvSchema.extend(appEnvSchema.shape);

/** The fully-validated environment (core + app). */
export type Env = z.infer<typeof envSchema>;

const productionRequiredKeys = [
  ...productionRequiredCoreKeys,
  ...productionRequiredAppKeys,
] as const;

/**
 * The ONLY place in apps/api allowed to read NODE_ENV from `process.env`.
 *
 * wrangler's esbuild `define` replaces the dotted process-env NODE_ENV
 * expression at BUILD time with the deploying shell's value (`bunx wrangler
 * deploy` loads .env, so "development"), ignoring the Worker's runtime var.
 * Destructuring is not rewritten, so this reads the real runtime value.
 *
 * Fails closed: anything but an explicit 'development' or 'test' (including
 * unset) is 'production'. `tests/unit/config/nodeEnvGuard.test.ts` fails the
 * build on any other read.
 */
export function runtimeNodeEnv(): 'production' | 'development' | 'test' {
  const { NODE_ENV } = process.env;
  return NODE_ENV === 'development' || NODE_ENV === 'test'
    ? NODE_ENV
    : 'production';
}

function validateEnv(): Env {
  // Skip validation in test to allow mocking / hermetic unit tests.
  if (runtimeNodeEnv() === 'test') {
    return { ...coreTestEnv, ...appTestEnv } as Env;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map(err => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');

    console.error(
      '\n╔════════════════════════════════════════════════════════╗'
    );
    console.error('║          ENVIRONMENT CONFIGURATION ERROR               ║');
    console.error(
      '╚════════════════════════════════════════════════════════╝\n'
    );
    console.error(
      'The following environment variables are missing or invalid:\n'
    );
    console.error(errors);
    console.error('\nSee .env.example for the full list of variables.\n');

    throw new Error(`Environment validation failed:\n${errors}`);
  }

  // Production-only required vars (optional in dev/test).
  if (result.data.NODE_ENV === 'production') {
    const missing = productionRequiredKeys.filter(
      key => !result.data[key as keyof Env]
    );
    if (missing.length > 0) {
      throw new Error(
        `The following variables are required in production: ${missing.join(', ')}`
      );
    }
  }

  return result.data;
}

/** The validated environment. Single source of truth for all env config. */
export const env = validateEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

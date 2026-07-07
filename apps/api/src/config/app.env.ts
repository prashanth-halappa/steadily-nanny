/**
 * App-specific environment schema (the extension point).
 *
 * SETUP: add your product's own environment variables here. This file is
 * intentionally nearly empty — the core framework vars live in `env.core.ts`.
 * Anything you add is merged into the validated `env` object in `env.ts` and is
 * fully typed at every call site.
 *
 * @module config/app.env
 */
import { z } from 'zod';

/**
 * Example app-specific variables. Replace with your own.
 */
export const appEnvSchema = z.object({
  // SETUP: example — a feature flag your product reads. Remove or replace.
  APP_EXAMPLE_FEATURE_ENABLED: z
    .string()
    .transform(val => val === 'true')
    .default(false),
});

/** App-specific env variables inferred from the schema. */
export type AppEnv = z.infer<typeof appEnvSchema>;

/**
 * Optional app vars that MUST be present in production. Add keys here as you add
 * production-critical app variables.
 */
export const productionRequiredAppKeys =
  [] as const satisfies readonly (keyof AppEnv)[];

/**
 * Placeholder app-var values for `NODE_ENV === 'test'`.
 */
export const appTestEnv: AppEnv = {
  APP_EXAMPLE_FEATURE_ENABLED: false,
};

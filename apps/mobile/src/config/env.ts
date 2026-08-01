/**
 * env — the ONLY module that reads `process.env` directly.
 *
 * Every other module imports the typed values from here. This keeps env access
 * greppable and centralized.
 *
 * GOTCHA: Expo inlines `process.env.EXPO_PUBLIC_*` at build time ONLY when it
 * appears as a static `process.env.EXPO_PUBLIC_X` literal. So each var below is
 * written out in full — do NOT refactor these into a dynamic lookup
 * (`process.env[key]`), or the value will be `undefined` in a release build.
 */

/** Dev-only warning when a recommended public env var is missing. */
function warnIfMissing(name: string, value: string | undefined): void {
  if (__DEV__ && !value) {
    console.warn(`[env] ${name} is not set — related features are disabled.`);
  }
}

export const env = {
  /** Base API URL, e.g. https://api.nanny.getsteadily.app/api */
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  posthogApiKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
  posthogHost:
    process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
} as const;

/** Call once at startup to surface missing-but-recommended config in dev. */
export function validateEnv(): void {
  warnIfMissing('EXPO_PUBLIC_API_URL', env.apiUrl);
  warnIfMissing('EXPO_PUBLIC_SUPABASE_URL', env.supabaseUrl);
  warnIfMissing('EXPO_PUBLIC_SUPABASE_ANON_KEY', env.supabaseAnonKey);
  warnIfMissing('EXPO_PUBLIC_SENTRY_DSN', env.sentryDsn);
  warnIfMissing('EXPO_PUBLIC_POSTHOG_API_KEY', env.posthogApiKey);
}

import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Two clients, created once and shared across the app:
// - `supabase` (ANON key): used to verify user JWTs. Subject to RLS.
// - `supabaseService` (SERVICE role): used by all repositories. BYPASSES RLS,
//   so it must be server-side only and never exposed to clients. Because RLS is
//   bypassed, the service/repository layer owns ownership enforcement.
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
export const supabaseService = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY
);

// A dev server pointing at a remote database is almost always an accident:
// bun auto-loads `.env` (which holds the PRODUCTION project) for any var the
// shell didn't export, and a long-lived dev process keeps whatever it started
// with. This bit three times in one day (GOLDEN-FIXES #26) — twice via stale
// dev servers nobody knew were prod-pointed. Loud banner, not a hard exit:
// deliberately pointing dev at a remote staging DB stays possible.
if (
  env.NODE_ENV === 'development' &&
  !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(env.SUPABASE_URL)
) {
  // biome-ignore lint/suspicious/noConsole: must be visible before the logger exists
  console.warn(
    `\n${'⚠'.repeat(30)}\n` +
      `⚠  DEV SERVER POINTED AT A REMOTE DATABASE: ${new URL(env.SUPABASE_URL).host}\n` +
      `⚠  Every write goes there. If you expected the local stack, export\n` +
      `⚠  SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_KEY before starting.\n` +
      `${'⚠'.repeat(30)}\n`
  );
}

export type { User } from '@supabase/supabase-js';

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

export type { User } from '@supabase/supabase-js';

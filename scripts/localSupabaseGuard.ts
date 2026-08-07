/**
 * Shared by every script that reads `apps/api/.env` for a service-role key
 * (that file points at the REMOTE project) and then writes real rows —
 * GOLDEN-FIXES #26. Call before constructing the Supabase client, always,
 * no flag to bypass it.
 */
export function assertLocalSupabaseUrl(supabaseUrl: string): void {
  // `new URL(...).hostname` keeps the brackets on an IPv6 literal
  // (`[::1]`), so strip them before comparing.
  const host = new URL(supabaseUrl).hostname.replace(/^\[|\]$/g, '');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(
      `refuses to run against ${host}: this script creates real auth users / writes real rows with a service-role key.\n` +
        '  Point SUPABASE_URL at the local stack instead (`supabase start`, then `supabase status -o env`) — never a hosted project.'
    );
  }
}

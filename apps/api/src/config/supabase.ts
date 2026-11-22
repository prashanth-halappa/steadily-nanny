import { createClient } from '@supabase/supabase-js';

// TRANSITIONAL (D1 migration, Phase 2): the repositories still call
// `supabaseService` until each moves to Drizzle `db`. Auth no longer uses
// Supabase, so SUPABASE_* left the validated env schema; this reads them raw
// and falls back to inert placeholders so importing it never throws. Delete
// this file once nothing imports it.
//
// SERVICE role: BYPASSES RLS, server-side only.
export const supabaseService = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_KEY || 'unset'
);

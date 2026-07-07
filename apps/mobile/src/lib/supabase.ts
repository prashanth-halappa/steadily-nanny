import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import 'react-native-url-polyfill/auto';

import { env } from '@/src/config/env';
import { zustandSecureStorage } from '@/src/lib/mmkvStorage';

// Read from the typed env module (the single place that touches process.env) —
// never `process.env` directly, so config stays centralized and greppable.
export const SUPABASE_URL = env.supabaseUrl;
export const SUPABASE_ANON_KEY = env.supabaseAnonKey;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // The session lives in encrypted MMKV (zustandSecureStorage). Cast to the
    // Supabase storage type — our StateStorage adapter is behaviorally
    // compatible, but the generics don't line up perfectly.
    // biome-ignore lint/suspicious/noExplicitAny: Supabase SupportedStorage type compatibility
    storage: zustandSecureStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Pause/resume the background token refresh with app foreground state so a
// backgrounded app isn't burning refreshes.
AppState.addEventListener('change', state => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

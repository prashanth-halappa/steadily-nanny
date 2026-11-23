import { type Href, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useAuthStore } from '@/src/store/auth';

/**
 * THE signed-out -> /welcome guard for every auth-gated route group
 * (`(private)` and `onboarding`). Returns true while signed out so the caller
 * can paint a neutral shell instead of its content.
 *
 * It reacts to the STATE, not to a button: sign-out from any screen, the 401
 * handler, a session that died while the app was backgrounded — all land
 * here. A per-button `router.replace('/welcome')` raced the sign-out's store
 * wipe and lost, stranding `/onboarding` on its spinner (2026-11-22).
 */
export function useSignedOutRedirect(): boolean {
  const router = useRouter();
  const signedOut = useAuthStore(s => s.isInitialized && !s.session);

  useEffect(() => {
    if (signedOut) router.replace('/welcome' as Href);
  }, [signedOut, router]);

  return signedOut;
}

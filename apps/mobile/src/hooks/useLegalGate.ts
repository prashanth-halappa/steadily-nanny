/**
 * @module hooks/useLegalGate
 * Route-independent legal acceptance gate (GOLDEN-FIXES #18).
 *
 * `enabled` is derived strictly from auth state (`isInitialized && !!session`),
 * never from router pathname or segments, so navigation never retriggers a
 * fetch/remount loop.
 */
import { type Href, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useLegalStatus } from '@/src/hooks/queries/useLegalStatus';
import { useAuthStore } from '@/src/store/auth';

export type LegalGateState =
  | 'pending'
  | 'error'
  | 'needs-acceptance'
  | 'accepted';

export interface UseLegalGateResult {
  state: LegalGateState;
  retry: () => void;
}

export function useLegalGate(): UseLegalGateResult {
  const router = useRouter();
  const isInitialized = useAuthStore(s => s.isInitialized);
  const session = useAuthStore(s => s.session);
  const enabled = isInitialized && !!session;

  const q = useLegalStatus({ enabled });

  let state: LegalGateState;
  if (!enabled || q.isPending) {
    state = 'pending';
  } else if (q.isError && !q.data) {
    state = 'error';
  } else if (!q.data) {
    state = 'pending';
  } else if (q.data.needsAcceptance) {
    state = 'needs-acceptance';
  } else {
    state = 'accepted';
  }

  useEffect(() => {
    if (state === 'needs-acceptance') {
      router.replace('/legal-accept' as Href);
    }
  }, [state, router]);

  return {
    state,
    retry: () => void q.refetch(),
  };
}

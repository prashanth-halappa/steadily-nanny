import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { hasAuthToken } from '@/src/api/client';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import {
  getSetupStepRoute,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useAuthStore } from '@/src/store/auth';
import { usePendingDeepLinkStore } from '@/src/store/pendingDeepLinkStore';

/**
 * Entry router — decides where to send the user, exactly once.
 */
export default function Index() {
  const router = useRouter();
  const isInitialized = useAuthStore(s => s.isInitialized);
  const session = useAuthStore(s => s.session);
  const onboarding = useIsOnboarded();

  // Route once per IDENTITY, not once per mount.
  //
  // This was a one-shot `useRef(false)` and it stranded every user who signed
  // in. Cold start renders this screen, it routes to /welcome, and the ref
  // flips true. Signing in then fires the auth store's SIGNED_IN handler, which
  // calls `router.replace('/')` — landing back on this SAME still-mounted
  // component, where the one-shot guard early-returns and no second routing
  // decision is ever made. The result is a permanent LoadingIndicator with a
  // valid session sitting behind it.
  //
  // Keying on the user id keeps the original intent (don't re-route on every
  // render) while still reacting to signed-out -> signed-in and account
  // switches. `undefined` means "no decision yet" and is deliberately distinct
  // from `null`, which means "we have decided this user is signed out".
  //
  // The key also carries the STATUS the decision was made on, not just the id.
  // Keyed on the bare id, a user routed into the wizard on a stale/incomplete
  // verdict was stranded there: a later successful refetch flipped the status
  // to 'onboarded', the effect re-ran, and the latch early-returned before it
  // could correct itself. Only a sign-out/sign-in cleared it.
  const routedForKey = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isInitialized) return;

    const userId = session?.user?.id ?? null;
    const routeKey = userId === null ? null : `${userId}:${onboarding.status}`;
    if (routedForKey.current === routeKey) return;

    if (!session) {
      // During cold start the API token can be set a tick before the Zustand
      // session hydrates — wait instead of bouncing the user to /welcome.
      // Deliberately do NOT record a decision here; we haven't made one yet.
      if (hasAuthToken()) return;
      routedForKey.current = null;
      router.replace('/welcome' as Href);
      return;
    }

    // The memberships query FAILED — onboarding state is UNKNOWN, so there is
    // no decision to make. Returning here (before the latch below) also keeps
    // the non-decision unrecorded, so a successful retry can still route.
    // Without this the `?? []` inside useIsOnboarded reads identically to a
    // brand-new user and drops a fully set-up one into the role fork.
    if (onboarding.membershipsError) return;

    // Wait for the server-derived onboarding status before deciding.
    // Routing on a transient in-flight value is exactly how a returning,
    // already-set-up user gets bounced through the role fork for a frame —
    // see useIsOnboarded's header comment.
    if (onboarding.status === 'loading') return;

    routedForKey.current = routeKey;
    if (onboarding.status === 'not-onboarded') {
      // A parent who already owns a household (just hasn't added a child
      // yet) resumes at the children step, not the role fork — the server
      // already told us their role.
      const step =
        onboarding.role === SETUP_ROLES.PARENT
          ? SETUP_STEPS.CHILDREN
          : SETUP_STEPS.ROLE;
      router.replace(getSetupStepRoute(step) as Href);
      return;
    }

    // Replay a queued deep link (from a push tap while logged out), else tabs.
    const pending = usePendingDeepLinkStore.getState().consumePendingLink();
    router.replace((pending ?? '/(private)/(tabs)/home') as Href);
  }, [
    isInitialized,
    session,
    onboarding.status,
    onboarding.role,
    onboarding.membershipsError,
    router,
  ]);

  // A spinner here would be a lie that never resolves — the router has
  // deliberately made no decision, so give the user the retry that unblocks it.
  if (onboarding.membershipsError) {
    return (
      <View testID="index-error" style={{ flex: 1 }}>
        <ErrorState variant="network" onRetry={onboarding.retryMemberships} />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <LoadingIndicator />
    </View>
  );
}

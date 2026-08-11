/**
 * @module app/t/[code]
 *
 * The universal-link landing route (§6.3). Tapping
 * `nanny.getsteadily.app/t/R4K-92T` with the app installed never reaches the
 * web page — iOS and Android intercept it — so the path needs an app route.
 *
 * NO CONFIG CHANGE WAS NEEDED, and that was verified rather than assumed:
 * `app.config.js` already claims `applinks:nanny.getsteadily.app` with AASA
 * components `{"/": "*"}`, and the Android intent filter is `autoVerify` with
 * `pathPrefix: '/'`. Both already match every path on the domain, this one
 * included. Android links stay UNVERIFIED until
 * `ANDROID_SHA256_CERT_FINGERPRINTS` is non-empty — `/.well-known/
 * assetlinks.json` answers 503 while it is `[]` — so this ships working on iOS
 * and dormant on Android until the owner pulls the Play App Signing
 * fingerprint. That is a release-checklist item, not a code one.
 *
 * There is no `(public)` route group in this app. The root `Stack` in
 * `app/_layout.tsx` declares no per-screen auth gate — `app/index.tsx` is the
 * only thing that routes on session — so a file directly under `src/app/`
 * renders for a signed-out user, exactly as `welcome.tsx` and `sign-in.tsx`
 * already do.
 *
 * Three cases, and this screen only ever routes; it renders a spinner and
 * nothing else.
 */
import {
  type Href,
  useLocalSearchParams,
  usePathname,
  useRouter,
} from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import {
  getSetupStepRoute,
  SETUP_PATHS,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useAuthStore } from '@/src/store/auth';
import { usePendingDeepLinkStore } from '@/src/store/pendingDeepLinkStore';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export default function TermsLinkRoute() {
  const router = useRouter();
  const pathname = usePathname();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const isInitialized = useAuthStore(s => s.isInitialized);
  const session = useAuthStore(s => s.session);
  const onboarding = useIsOnboarded();
  // Route once. Without this the effect re-fires on every onboarding tick and
  // stacks replaces on top of the screen it just left.
  const routed = useRef(false);

  useEffect(() => {
    if (!isInitialized || routed.current) return;

    // (a) Signed out: park the href and send them to welcome. The store TTLs
    // at 10 minutes and `CodeEntryScreen` consumes it once routing is ready.
    if (!session) {
      routed.current = true;
      usePendingDeepLinkStore
        .getState()
        .setPendingLink(code ? `/t/${code}` : pathname);
      router.replace('/welcome' as Href);
      return;
    }

    // Unknown onboarding state is NOT a decision. Wait — the same
    // fail-toward-WAIT posture `app/index.tsx` keeps.
    if (onboarding.membershipsError) return;
    if (onboarding.status === 'loading') return;
    if (!code) {
      routed.current = true;
      router.replace('/' as Href);
      return;
    }

    routed.current = true;

    // (b) Signed in and onboarded: the wizard is unreachable for them
    // (`app/onboarding/_layout.tsx` bounces an onboarded user), so the code
    // goes to the settings join screen, pre-filled.
    if (onboarding.status === 'onboarded') {
      router.replace(`/settings/join-household?code=${code}` as Href);
      return;
    }

    // (c) Signed in mid-wizard: jump straight to CODE with the code filled.
    // `path` only — never `role`, which `_layout`'s `wizardEngaged` predicate
    // reads and which the role fork owns.
    useSetupProgressStore.getState().setPath(SETUP_PATHS.JOIN);
    useSetupProgressStore.getState().setCurrentStep(SETUP_STEPS.CODE);
    router.replace(
      `${getSetupStepRoute(SETUP_STEPS.CODE)}?code=${code}` as Href
    );
  }, [
    isInitialized,
    session,
    code,
    pathname,
    onboarding.status,
    onboarding.membershipsError,
    router,
  ]);

  return (
    <View
      testID="terms-link-route"
      className="flex-1 items-center justify-center bg-background"
    >
      <LoadingIndicator />
    </View>
  );
}

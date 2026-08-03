/**
 * @module app/onboarding/_layout
 *
 * Stack for the setup wizard. Also the choke point that bounces an already-
 * onboarded user out of every `/onboarding/*` screen.
 *
 * Why here, not in RoleScreen alone: the entry router (`app/index.tsx`) can
 * correctly decide `onboarded` *after* it has already `replace`d into the
 * wizard on a transient `not-onboarded` verdict (cleared query cache on
 * SIGNED_IN, token blip, etc.). Once Index unmounts, its latch-recovery
 * never runs. Without a guard on this layout, a nanny with two active
 * memberships stays stranded on "Who are you?" forever — observed on device
 * 2026-08-02. Unknown / loading / error must NOT bounce; only a confirmed
 * `onboarded` status does.
 *
 * Paint gate: only mount the wizard Stack when status is confirmed
 * `not-onboarded`. While loading or while bouncing an onboarded user home,
 * show the same spinner shell as Index — never flash "Who are you?".
 */
import { type Href, Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';

export default function OnboardingLayout() {
  const router = useRouter();
  const onboarding = useIsOnboarded();

  useEffect(() => {
    if (onboarding.membershipsError) return;
    if (onboarding.status !== 'onboarded') return;
    router.replace('/(private)/(tabs)/home' as Href);
  }, [onboarding.membershipsError, onboarding.status, router]);

  // Confirmed new / incomplete user — show the wizard.
  if (!onboarding.membershipsError && onboarding.status === 'not-onboarded') {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  // loading, onboarded (redirect in flight), or membershipsError — never paint
  // RoleScreen. Index owns the network ErrorState for membershipsError when
  // the user is still on `/`; here we just wait / bounce.
  return (
    <View
      testID="onboarding-layout-loading"
      className="flex-1 items-center justify-center bg-background"
    >
      <LoadingIndicator />
    </View>
  );
}

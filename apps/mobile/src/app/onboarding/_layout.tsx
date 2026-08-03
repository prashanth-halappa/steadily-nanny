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
 */
import { type Href, Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';

export default function OnboardingLayout() {
  const router = useRouter();
  const onboarding = useIsOnboarded();

  useEffect(() => {
    if (onboarding.membershipsError) return;
    if (onboarding.status !== 'onboarded') return;
    router.replace('/(private)/(tabs)/home' as Href);
  }, [onboarding.membershipsError, onboarding.status, router]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

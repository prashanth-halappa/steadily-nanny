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
 *
 * WIZARD-OWNS-COMPLETION EXCEPTION: `useIsOnboarded`'s server predicate can
 * flip to `onboarded` PARTWAY through the client-side step sequence — e.g.
 * right after ChildrenScreen's first child is added (owner + >=1 child), or
 * right after CodeEntryScreen redeems an invite (active membership) — both
 * well before the wizard's actual last step (calendar permission, or
 * notifications for a helper). Auto-redirecting on that first tick would
 * unmount the Stack mid-wizard and strand the user before they ever reach
 * Invite/Availability/Notifications/Calendar. Once the local step machine
 * has engaged (`setupProgress.role` is set — the very first thing
 * RoleScreen does), IT owns when the wizard is done: the terminal screen's
 * own CTA calls `router.replace(home)`, exactly like InviteScreen/
 * AvailabilityScreen always have. This guard's auto-bounce stays reserved
 * for its original purpose — recovering a user who is sitting in
 * `/onboarding/*` withOUT having engaged the local wizard this session (the
 * stranded-nanny repro above), where `role` is still null.
 */
import { type Href, Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export default function OnboardingLayout() {
  const router = useRouter();
  const onboarding = useIsOnboarded();
  const wizardEngaged = useSetupProgressStore(s => s.role !== null);

  useEffect(() => {
    if (onboarding.membershipsError) return;
    if (onboarding.status !== 'onboarded') return;
    if (wizardEngaged) return;
    router.replace('/(private)/(tabs)/home' as Href);
  }, [onboarding.membershipsError, onboarding.status, wizardEngaged, router]);

  // Confirmed new / incomplete user, or an onboarded user actively mid-wizard
  // (see WIZARD-OWNS-COMPLETION above) — show the wizard.
  const showWizard =
    !onboarding.membershipsError &&
    (onboarding.status === 'not-onboarded' ||
      (onboarding.status === 'onboarded' && wizardEngaged));

  if (showWizard) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaView>
    );
  }

  // loading, onboarded-and-not-engaged (redirect in flight), or
  // membershipsError — never paint RoleScreen. Index owns the network
  // ErrorState for membershipsError when the user is still on `/`; here we
  // just wait / bounce.
  return (
    <View
      testID="onboarding-layout-loading"
      className="flex-1 items-center justify-center bg-background"
    >
      <LoadingIndicator />
    </View>
  );
}

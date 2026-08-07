/**
 * @module domains/setup/components/InviteScreen
 *
 * Parent setup step 3 (final): generate an invite code for a chosen role and
 * share it. No native clipboard module is wired up (would need a dev-client
 * rebuild), so "copy" is covered by the OS share sheet, which offers Copy
 * natively, plus the code itself being selectable text.
 *
 * The code is minted by an EXPLICIT tap, never automatically on mount. The
 * auto-mint version fired a single `useEffect` the moment `householdId` was
 * present — which, in the wizard, is before the parent has touched the role
 * picker — so every wizard invite was silently `role: 'nanny'` regardless of
 * what was picked, and the `hasRequestedInvite` ref blocked any later
 * re-mint. Same shape as `ManageInviteScreen` now: pick a role, then
 * generate, and one tap mints exactly one code.
 *
 * NOT the last wizard step — advances to NOTIFICATIONS_PERMISSION, same
 * pattern as CodeEntryScreen advancing to AVAILABILITY. See
 * `getNextSetupStep` in `domains/setup/types`.
 */

import type { HouseholdInviteRole } from '@steadily-nanny/shared-types/schemas/household.schema';
import { HOUSEHOLD_INVITE_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { InviteCodeCard } from '@/src/domains/setup/components/InviteCodeCard';
import { InviteRolePicker } from '@/src/domains/setup/components/InviteRolePicker';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getSetupStepRoute,
  getStepProgress,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useCreateInvite } from '@/src/hooks/mutations/useCreateInvite';
import { useRevokeInvite } from '@/src/hooks/mutations/useRevokeInvite';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function InviteScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const householdId = useSetupProgressStore(s => s.householdId);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const createInvite = useCreateInvite(householdId ?? '');
  const revokeInvite = useRevokeInvite(householdId ?? '');
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedRole, setSelectedRole] = useState<HouseholdInviteRole>(
    HOUSEHOLD_INVITE_ROLES.NANNY
  );

  const invite = createInvite.data ?? null;
  const code = invite?.code ?? null;

  // One tap = one code. Changing the role selection never mints anything on
  // its own, so the picker stays free of duplicate-code side effects.
  const onGenerate = () => {
    if (!householdId || createInvite.isPending) return;
    setHasStarted(true);
    createInvite.mutate({ role: selectedRole });
  };

  const onShare = () => {
    if (!code) return;
    void Share.share({ message: t('invite.shareMessage', { code }) });
  };

  // Clears BOTH the mutation state InviteCodeCard reads (`createInvite`'s
  // `data`) and the local `hasStarted` flag — resetting only the former
  // leaves the card stuck on its loading spinner instead of returning to
  // the role picker so the parent can mint a fresh code.
  const onRevoke = () => {
    if (!invite) return;
    revokeInvite.mutate(invite.id, {
      onSuccess: () => {
        createInvite.reset();
        setHasStarted(false);
      },
    });
  };

  const onContinue = () => {
    setCurrentStep(SETUP_STEPS.NOTIFICATIONS_PERMISSION);
    router.push(
      getSetupStepRoute(SETUP_STEPS.NOTIFICATIONS_PERMISSION) as Href
    );
  };

  return (
    <SetupScreenShell
      testID="invite-screen"
      progress={getStepProgress(SETUP_ROLES.PARENT, SETUP_STEPS.INVITE)}
      title={t('invite.wizardTitle')}
      subtitle={t('invite.wizardSubtitle')}
      ctaLabel={t('invite.continueButton')}
      ctaDisabled={!code}
      onCta={onContinue}
    >
      {hasStarted ? (
        // flex-1 + justify-start defeats the shell's vertical centring, which
        // stranded the code card mid-screen under a void of empty space.
        <View className="flex-1 justify-start gap-4">
          <InviteCodeCard
            invite={invite}
            isError={createInvite.isError}
            onRetry={onGenerate}
            onRevoke={onRevoke}
            isRevoking={revokeInvite.isPending}
          />
          <Button
            testID="invite-share-button"
            variant="outline"
            onPress={onShare}
            disabled={!code}
          >
            <Text>{t('invite.shareButton')}</Text>
          </Button>
        </View>
      ) : (
        <>
          <InviteRolePicker
            selected={selectedRole}
            onSelect={setSelectedRole}
          />
          <Button
            testID="invite-generate-button"
            onPress={onGenerate}
            disabled={!householdId}
          >
            <Text>{t('invite.generateButton')}</Text>
          </Button>
        </>
      )}
    </SetupScreenShell>
  );
}

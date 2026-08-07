/**
 * @module domains/setup/components/ManageInviteScreen
 *
 * Post-onboarding entry point (Settings → Invite someone): a parent could
 * only ever generate ONE invite code, during first-run setup — there was no
 * way to onboard another household member later. Unlike the wizard's
 * `InviteScreen`, this screen does NOT auto-generate a code on mount:
 * revisiting a settings screen must be idempotent, and auto-firing
 * `useCreateInvite` every time this screen is reached would silently mint
 * an unused invite code per visit. The parent explicitly taps "Generate"
 * instead. Role is chosen via `InviteRolePicker` (nanny / co-parent / helper).
 *
 * Reuses `InviteCodeCard` for the code/retry display so both screens render
 * identical UI once a code exists. `SetupScreenShell`'s CTA goes back to
 * wherever the parent came from (no progress bar, no "next step").
 */
import type { HouseholdInviteRole } from '@steadily-nanny/shared-types/schemas/household.schema';
import { HOUSEHOLD_INVITE_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { InviteCodeCard } from '@/src/domains/setup/components/InviteCodeCard';
import { InviteRolePicker } from '@/src/domains/setup/components/InviteRolePicker';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useCreateInvite } from '@/src/hooks/mutations/useCreateInvite';
import { useRevokeInvite } from '@/src/hooks/mutations/useRevokeInvite';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';

export function ManageInviteScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const onboarding = useIsOnboarded();
  const householdId = onboarding.householdId ?? '';

  const createInvite = useCreateInvite(householdId);
  const revokeInvite = useRevokeInvite(householdId);
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedRole, setSelectedRole] = useState<HouseholdInviteRole>(
    HOUSEHOLD_INVITE_ROLES.NANNY
  );

  const invite = createInvite.data ?? null;
  const code = invite?.code ?? null;

  const onGenerate = () => {
    setHasStarted(true);
    createInvite.mutate({ role: selectedRole });
  };

  const onShare = () => {
    if (!code) return;
    void Share.share({ message: t('invite.shareMessage', { code }) });
  };

  // See InviteScreen: both the mutation state InviteCodeCard reads and the
  // local `hasStarted` flag must clear, or the card is stuck on its loading
  // spinner instead of returning to the role picker.
  const onRevoke = () => {
    if (!invite) return;
    revokeInvite.mutate(invite.id, {
      onSuccess: () => {
        createInvite.reset();
        setHasStarted(false);
      },
    });
  };

  return (
    <SetupScreenShell
      testID="manage-invite-screen"
      title={t('invite.manageTitle')}
      subtitle={t('invite.manageSubtitle')}
      ctaLabel={t('invite.doneButton')}
      onCta={() => router.back()}
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      {hasStarted ? (
        // See InviteScreen: the shell centres its children, which left a void
        // above the code card once the picker was replaced by it.
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
            disabled={!onboarding.householdId}
          >
            <Text>{t('invite.generateButton')}</Text>
          </Button>
        </>
      )}
    </SetupScreenShell>
  );
}

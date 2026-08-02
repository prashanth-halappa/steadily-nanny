/**
 * @module domains/setup/components/ManageInviteScreen
 *
 * Post-onboarding entry point (Settings -> Invite a nanny): a parent could
 * only ever generate ONE invite code, during first-run setup — there was no
 * way to onboard a second nanny. Unlike the wizard's `InviteScreen`, this
 * screen does NOT auto-generate a code on mount: revisiting a settings
 * screen must be idempotent, and auto-firing `useCreateInvite` every time
 * this screen is reached would silently mint an unused invite code per
 * visit. The parent explicitly taps "Generate" instead.
 *
 * Reuses `InviteCodeCard` for the code/retry display so both screens render
 * identical UI once a code exists. `SetupScreenShell`'s CTA goes back to
 * wherever the parent came from (no progress bar, no "next step").
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { InviteCodeCard } from '@/src/domains/setup/components/InviteCodeCard';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useCreateInvite } from '@/src/hooks/mutations/useCreateInvite';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';

export function ManageInviteScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const onboarding = useIsOnboarded();
  const householdId = onboarding.householdId ?? '';

  const createInvite = useCreateInvite(householdId);
  const [hasStarted, setHasStarted] = useState(false);

  const code = createInvite.data?.code ?? null;

  const onGenerate = () => {
    setHasStarted(true);
    createInvite.mutate({ role: 'nanny' });
  };

  const onShare = () => {
    if (!code) return;
    void Share.share({ message: t('invite.shareMessage', { code }) });
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
        <>
          <InviteCodeCard
            code={code}
            isError={createInvite.isError}
            onRetry={onGenerate}
          />
          <Button
            testID="invite-share-button"
            variant="outline"
            onPress={onShare}
            disabled={!code}
          >
            <Text>{t('invite.shareButton')}</Text>
          </Button>
        </>
      ) : (
        <Button
          testID="invite-generate-button"
          onPress={onGenerate}
          disabled={!onboarding.householdId}
        >
          <Text>{t('invite.generateButton')}</Text>
        </Button>
      )}
    </SetupScreenShell>
  );
}

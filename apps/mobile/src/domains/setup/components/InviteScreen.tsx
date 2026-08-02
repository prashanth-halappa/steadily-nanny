/**
 * @module domains/setup/components/InviteScreen
 *
 * Parent setup step 3 (final): generate a nanny invite code and share it.
 * No native clipboard module is wired up (would need a dev-client rebuild —
 * see GOLDEN-FIXES-style note below), so "copy" is covered by the OS share
 * sheet, which offers Copy natively, plus the code itself being selectable
 * text.
 */
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { InviteCodeCard } from '@/src/domains/setup/components/InviteCodeCard';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useCreateInvite } from '@/src/hooks/mutations/useCreateInvite';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function InviteScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const householdId = useSetupProgressStore(s => s.householdId);
  const createInvite = useCreateInvite(householdId ?? '');
  const hasRequestedInvite = useRef(false);

  useEffect(() => {
    if (householdId && !hasRequestedInvite.current) {
      hasRequestedInvite.current = true;
      createInvite.mutate({ role: 'nanny' });
    }
  }, [householdId, createInvite]);

  const code = createInvite.data?.code ?? null;

  const onShare = () => {
    if (!code) return;
    void Share.share({ message: t('invite.shareMessage', { code }) });
  };

  const onDone = () => {
    // No local "complete" flag to flip — useIsOnboarded is server-derived and
    // will already read this parent as onboarded (household + >= 1 child
    // exist by the time this screen is reachable; ChildrenScreen's CTA
    // requires it).
    router.replace('/(private)/(tabs)/home' as Href);
  };

  return (
    <SetupScreenShell
      testID="invite-screen"
      progress={1}
      title={t('invite.wizardTitle')}
      subtitle={t('invite.wizardSubtitle')}
      ctaLabel={t('invite.doneButton')}
      ctaDisabled={!code}
      onCta={onDone}
    >
      <InviteCodeCard
        code={code}
        isError={createInvite.isError}
        onRetry={() => createInvite.mutate({ role: 'nanny' })}
      />

      <Button
        testID="invite-share-button"
        variant="outline"
        onPress={onShare}
        disabled={!code}
      >
        <Text>{t('invite.shareButton')}</Text>
      </Button>
    </SetupScreenShell>
  );
}

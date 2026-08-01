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
import { Share, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body } from '@/src/components/ui/typography';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useCreateInvite } from '@/src/hooks/mutations/useCreateInvite';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function InviteScreen() {
  const router = useRouter();
  const householdId = useSetupProgressStore(s => s.householdId);
  const complete = useSetupProgressStore(s => s.complete);
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
    void Share.share({
      message: `Join our household on Steadily Nanny — use invite code ${code} when you sign in.`,
    });
  };

  const onDone = () => {
    complete();
    router.replace('/(private)/(tabs)/home' as Href);
  };

  return (
    <SetupScreenShell
      testID="invite-screen"
      progress={1}
      title="Invite your nanny"
      subtitle="Share this code — they'll enter it when they sign up."
      ctaLabel="Done"
      ctaDisabled={!code}
      onCta={onDone}
    >
      <View className="items-center gap-4 rounded-2xl border border-border bg-card p-6">
        {code ? (
          <Text
            testID="invite-code-value"
            selectable
            className="font-sora-bold text-3xl tracking-widest text-primary"
          >
            {code}
          </Text>
        ) : (
          <LoadingIndicator />
        )}
        {createInvite.isError ? (
          <>
            <Body className="text-center text-destructive">
              Couldn't generate an invite code.
            </Body>
            <Button
              testID="invite-retry-button"
              variant="outline"
              onPress={() => createInvite.mutate({ role: 'nanny' })}
            >
              <Text>Try again</Text>
            </Button>
          </>
        ) : null}
      </View>

      <Button
        testID="invite-share-button"
        variant="outline"
        onPress={onShare}
        disabled={!code}
      >
        <Text>Share code</Text>
      </Button>
    </SetupScreenShell>
  );
}

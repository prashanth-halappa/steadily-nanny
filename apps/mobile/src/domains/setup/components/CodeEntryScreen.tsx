/**
 * @module domains/setup/components/CodeEntryScreen
 *
 * Nanny setup step 1: enter a household invite code, preview who it's for
 * (household name + children's first names — nothing more, see
 * `InvitePreviewSchema`), then redeem it to join.
 */
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { getSetupStepRoute, SETUP_STEPS } from '@/src/domains/setup/types';
import { useRedeemInvite } from '@/src/hooks/mutations/useRedeemInvite';
import { useInvitePreview } from '@/src/hooks/queries/useInvitePreview';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function CodeEntryScreen() {
  const router = useRouter();
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const [code, setCode] = useState('');
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);

  const preview = useInvitePreview(submittedCode ?? '');
  const redeemInvite = useRedeemInvite();

  const onCheckCode = () => {
    if (!code.trim()) return;
    setSubmittedCode(code.trim());
  };

  const onJoin = () => {
    if (!submittedCode) return;
    redeemInvite.mutate(submittedCode, {
      onSuccess: () => {
        setCurrentStep(SETUP_STEPS.AVAILABILITY);
        router.push(getSetupStepRoute(SETUP_STEPS.AVAILABILITY) as Href);
      },
    });
  };

  return (
    <SetupScreenShell
      testID="code-screen"
      progress={0.5}
      title="Enter your invite code"
      subtitle="Ask the family for the code they shared with you."
      ctaLabel={preview.data ? 'Join household' : 'Continue'}
      ctaDisabled={
        preview.data ? redeemInvite.isPending : code.trim().length === 0
      }
      onCta={preview.data ? onJoin : onCheckCode}
    >
      <View className="gap-2">
        <Label>Invite code</Label>
        <Input
          testID="code-input"
          accessibilityLabel="Invite code"
          value={code}
          onChangeText={text => {
            setCode(text);
            setSubmittedCode(null);
          }}
          placeholder="XXX-XXX"
          autoCapitalize="characters"
          autoFocus
        />
      </View>

      {preview.isFetching ? <LoadingIndicator /> : null}

      {preview.isError ? (
        <Body testID="code-error" className="text-destructive">
          That code doesn't look right. Check it and try again.
        </Body>
      ) : null}

      {preview.data ? (
        <View
          testID="code-preview-card"
          className="gap-2 rounded-2xl border border-border bg-card p-4"
        >
          <H3 testID="code-preview-household">{preview.data.household_name}</H3>
          {preview.data.children_first_names.length > 0 ? (
            <Text
              testID="code-preview-children"
              className="text-muted-foreground"
            >
              {preview.data.children_first_names.join(', ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {redeemInvite.isError ? (
        <Body className="text-destructive">
          Couldn't join that household. Try again.
        </Body>
      ) : null}
    </SetupScreenShell>
  );
}

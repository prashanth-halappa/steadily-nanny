/**
 * @module domains/setup/components/CodeEntryScreen
 *
 * Nanny setup step 1: enter a household invite code, preview who it's for
 * (household name + children's first names — nothing more, see
 * `InvitePreviewSchema`), then redeem it to join.
 */
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card } from '@/src/components/ui/card';
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
  const { t } = useTranslation('auth');
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
      title={t('onboarding.code.title')}
      subtitle={t('onboarding.code.subtitle')}
      ctaLabel={
        preview.data ? t('onboarding.code.joinHousehold') : t('common:continue')
      }
      ctaDisabled={
        preview.data ? redeemInvite.isPending : code.trim().length === 0
      }
      onCta={preview.data ? onJoin : onCheckCode}
    >
      <View className="gap-2">
        <Label>{t('onboarding.code.inviteCodeLabel')}</Label>
        <Input
          testID="code-input"
          accessibilityLabel={t('onboarding.code.inviteCodeLabel')}
          value={code}
          onChangeText={text => {
            setCode(text);
            setSubmittedCode(null);
          }}
          placeholder={t('onboarding.code.placeholder')}
          autoCapitalize="characters"
          autoFocus
        />
      </View>

      {preview.isFetching ? <LoadingIndicator /> : null}

      {preview.isError ? (
        <Body testID="code-error" className="text-destructive">
          {t('onboarding.code.invalidError')}
        </Body>
      ) : null}

      {preview.data ? (
        <Card testID="code-preview-card" className="gap-2 p-5.5">
          <H3 testID="code-preview-household">{preview.data.household_name}</H3>
          {preview.data.children_first_names.length > 0 ? (
            <Text
              testID="code-preview-children"
              className="text-muted-foreground"
            >
              {preview.data.children_first_names.join(', ')}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {redeemInvite.isError ? (
        <Body className="text-destructive">
          {t('onboarding.code.redeemError')}
        </Body>
      ) : null}
    </SetupScreenShell>
  );
}

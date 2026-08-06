/**
 * @module domains/setup/components/CodeEntryScreen
 *
 * Nanny setup step 1: give your name, enter a household invite code, preview
 * who it's for (household name + children's first names — nothing more, see
 * `InvitePreviewSchema`), then redeem it to join.
 *
 * The name lives here rather than on its own screen because the parent flow
 * has no name step either — it derives one from auth metadata during the
 * `ChildrenScreen` bootstrap. Same derivation pre-fills this field, so the
 * nanny confirms or corrects a name instead of typing one cold, and the flow
 * keeps its three steps (role -> code -> availability).
 *
 * ORDER MATTERS: the profile write runs BEFORE `redeemInvite`. Joining
 * snapshots the member's display name, and a null one renders as the 'Carer'
 * fallback on every money surface her family sees.
 */
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { FieldError } from '@/src/components/ui/field-error';
import { FieldLabel } from '@/src/components/ui/field-label';
import { Input } from '@/src/components/ui/input';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H3 } from '@/src/components/ui/typography';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { getSetupStepRoute, SETUP_STEPS } from '@/src/domains/setup/types';
import { useRedeemInvite } from '@/src/hooks/mutations/useRedeemInvite';
import { useUpdateName } from '@/src/hooks/mutations/useUpdateName';
import { useUpsertProfile } from '@/src/hooks/mutations/useUpsertProfile';
import { useInvitePreview } from '@/src/hooks/queries/useInvitePreview';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import {
  buildBootstrapProfileRequest,
  deriveBootstrapName,
} from '@/src/lib/bootstrapUserProfile';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function CodeEntryScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const authUser = useAuthStore(s => s.session?.user) ?? null;
  const [code, setCode] = useState('');
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);

  const preview = useInvitePreview(submittedCode ?? '');
  const profile = useUserProfile();
  const upsertProfile = useUpsertProfile();
  const updateName = useUpdateName();
  const redeemInvite = useRedeemInvite();

  // Untouched field falls back to the saved name, then to the same auth
  // derivation the parent bootstrap uses — never to an empty box.
  const name =
    nameDraft ??
    profile.data?.name ??
    (authUser ? deriveBootstrapName(authUser) : '');

  const onCheckCode = () => {
    if (!code.trim()) return;
    setSubmittedCode(code.trim());
  };

  const onJoin = () => {
    if (!submittedCode) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError(true);
      return;
    }

    void (async () => {
      try {
        if (profile.data?.user_id) {
          // PATCH, not upsert: an existing row already has real city/country
          // that the bootstrap payload's placeholders would overwrite.
          if (trimmedName !== profile.data.name) {
            await updateName.mutateAsync({ name: trimmedName });
          }
        } else if (authUser) {
          await upsertProfile.mutateAsync({
            ...buildBootstrapProfileRequest(authUser),
            name: trimmedName,
          });
        }
        await redeemInvite.mutateAsync(submittedCode);
        setCurrentStep(SETUP_STEPS.AVAILABILITY);
        router.push(getSetupStepRoute(SETUP_STEPS.AVAILABILITY) as Href);
      } catch {
        // Each mutation toasts its own failure; redeem also renders inline.
      }
    })();
  };

  const isJoining =
    redeemInvite.isPending || upsertProfile.isPending || updateName.isPending;

  return (
    <SetupScreenShell
      testID="code-screen"
      progress={0.5}
      title={t('onboarding.code.title')}
      subtitle={t('onboarding.code.subtitle')}
      ctaLabel={
        preview.data ? t('onboarding.code.joinHousehold') : t('common:continue')
      }
      ctaDisabled={preview.data ? isJoining : code.trim().length === 0}
      onCta={preview.data ? onJoin : onCheckCode}
    >
      <View className="gap-2">
        <FieldLabel>{t('onboarding.code.nameLabel')}</FieldLabel>
        <Input
          testID="name-input"
          accessibilityLabel={t('onboarding.code.nameLabel')}
          value={name}
          onChangeText={text => {
            setNameDraft(text);
            if (text.trim()) setNameError(false);
          }}
          placeholder={t('onboarding.code.namePlaceholder')}
          autoCapitalize="words"
          autoFocus
          error={nameError}
        />
        {nameError ? (
          <FieldError testID="name-error">
            {t('onboarding.code.nameRequired')}
          </FieldError>
        ) : null}
      </View>

      <View className="gap-2">
        <FieldLabel>{t('onboarding.code.inviteCodeLabel')}</FieldLabel>
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
        />
      </View>

      {preview.isFetching ? <LoadingIndicator /> : null}

      {preview.isError ? (
        <FieldError testID="code-error">
          {t('onboarding.code.invalidError')}
        </FieldError>
      ) : null}

      {preview.data ? (
        <Card testID="code-preview-card" className="gap-2 p-5.5">
          <H3 testID="code-preview-household">{preview.data.household_name}</H3>
          {preview.data.children_first_names.length > 0 ? (
            <Body
              testID="code-preview-children"
              className="text-muted-foreground"
            >
              {preview.data.children_first_names.join(', ')}
            </Body>
          ) : null}
        </Card>
      ) : null}

      {redeemInvite.isError ? (
        <FieldError>{t('onboarding.code.redeemError')}</FieldError>
      ) : null}
    </SetupScreenShell>
  );
}

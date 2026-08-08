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
 * nanny confirms or corrects a name instead of typing one cold.
 *
 * ORDER MATTERS: the profile write runs BEFORE `redeemInvite`. Joining
 * snapshots the member's display name, and a null one renders as the 'Carer'
 * fallback on every money surface her family sees.
 *
 * The invitee never explicitly picks "I'm a helper" — RoleScreen's
 * non-parent fork just leads here. Which household role they actually got
 * (nanny vs. helper) is only known once the invite is redeemed, so THIS is
 * where the local wizard role is resolved and set — `stepsForRole` then
 * branches correctly for the remaining steps (helper skips availability and
 * calendar sync; nanny gets both).
 */
import { HOUSEHOLD_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { FieldError } from '@/src/components/ui/field-error';
import { FieldLabel } from '@/src/components/ui/field-label';
import { Input } from '@/src/components/ui/input';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getNextSetupStep,
  getSetupStepRoute,
  getStepProgress,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
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

export interface CodeEntryScreenProps {
  /**
   * SETTINGS ENTRY POINT (`/settings/join-household`). Presence of this
   * callback IS the variant switch: an ALREADY-ONBOARDED carer redeeming a
   * code for an ADDITIONAL household.
   *
   * The wizard step machine must NOT run for them. `setupProgress` is
   * MMKV-PERSISTED, and `app/onboarding/_layout.tsx` reads `role !== null`
   * as `wizardEngaged` to SUPPRESS its bounce-an-onboarded-user-out-of-the-
   * wizard guard. One `setRole` from here would disarm that guard for this
   * user on this device permanently.
   */
  onJoined?: (householdId: string) => void;
}

export function CodeEntryScreen({ onJoined }: CodeEntryScreenProps = {}) {
  const { t } = useTranslation('auth');
  const { t: tHousehold } = useTranslation('household');
  const router = useRouter();
  const setRole = useSetupProgressStore(s => s.setRole);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const signOut = useAuthStore(s => s.signOut);
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

  // A nanny (or the invite-code path off RoleScreen — see that screen's
  // header comment) who lands here without a code in hand used to be
  // trapped: no back, no sign-out. `replace`, not `back()` — RoleScreen
  // itself navigates here with `router.replace`, which drops RoleScreen
  // from history, so a bare `back()` would skip past it to whatever
  // preceded RoleScreen instead of returning to the role fork.
  const onBack = () => {
    // Settings variant: `back()` is correct here — this route was pushed onto
    // the private stack, not `replace`d over RoleScreen.
    if (onJoined) {
      router.back();
      return;
    }
    router.replace(getSetupStepRoute(SETUP_STEPS.ROLE) as Href);
  };

  const onJoin = () => {
    if (!submittedCode) return;
    const trimmedName = name.trim();
    if (!onJoined && !trimmedName) {
      setNameError(true);
      return;
    }

    void (async () => {
      try {
        // Settings variant: no name field, so nothing to persist. Skipping the
        // block also closes a real hazard — with `profile` still unresolved,
        // the `else if (authUser)` arm would upsert the BOOTSTRAP PLACEHOLDER
        // city/country over this user's real profile.
        if (!onJoined) {
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
        }
        const membership = await redeemInvite.mutateAsync(submittedCode);
        // BEFORE the role/step resolution below — never write the persisted
        // wizard state for an already-onboarded user (see CodeEntryScreenProps).
        if (onJoined) {
          onJoined(membership.household_id);
          return;
        }
        // A co-parent invite (server role 'parent', see HOUSEHOLD_ROLES) is
        // JOINING a household the redeem above already gave them — unlike
        // RoleScreen's own PARENT fork, which is the household's FIRST
        // member and must create it via CHILDREN -> INVITE. Mapping to
        // SETUP_ROLES.PARENT here is still correct (it is the role), but the
        // step entry point can't be CODE's "next" within the parent
        // sequence: `stepsForRole(PARENT)` doesn't contain CODE at all
        // (that array is [ROLE, CHILDREN, INVITE, NOTIFICATIONS_PERMISSION,
        // CALENDAR_PERMISSION]), so `getNextSetupStep` returns null and the
        // existing `?? NOTIFICATIONS_PERMISSION` fallback below already
        // lands a joining co-parent past CHILDREN/INVITE — exactly the
        // "already has a household" entry point they need. No fallback
        // route change required; this comment documents why that's safe.
        const resolvedRole =
          membership.role === HOUSEHOLD_ROLES.HELPER
            ? SETUP_ROLES.HELPER
            : membership.role === HOUSEHOLD_ROLES.PARENT
              ? SETUP_ROLES.PARENT
              : SETUP_ROLES.NANNY;
        setRole(resolvedRole);
        const next =
          getNextSetupStep(resolvedRole, SETUP_STEPS.CODE) ??
          SETUP_STEPS.NOTIFICATIONS_PERMISSION;
        setCurrentStep(next);
        router.push(getSetupStepRoute(next) as Href);
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
      progress={
        onJoined
          ? undefined
          : getStepProgress(SETUP_ROLES.NANNY, SETUP_STEPS.CODE)
      }
      onBack={onBack}
      backLabel={t('common:back')}
      title={
        onJoined ? tHousehold('invite.joinTitle') : t('onboarding.code.title')
      }
      subtitle={
        onJoined
          ? tHousehold('invite.joinSubtitle')
          : t('onboarding.code.subtitle')
      }
      ctaLabel={
        preview.data ? t('onboarding.code.joinHousehold') : t('common:continue')
      }
      ctaDisabled={preview.data ? isJoining : code.trim().length === 0}
      onCta={preview.data ? onJoin : onCheckCode}
    >
      {onJoined ? null : (
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
      )}

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
          autoFocus={Boolean(onJoined)}
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

      {/* Second escape hatch alongside `onBack`: someone who signed up
          without a code in hand and doesn't want to go back to the role
          fork either should still be able to leave, not just retreat one
          step. Ghost/ text-only, same weight as `backToSignIn` elsewhere in
          this namespace. Wizard only — a ghost "Sign out" on a Settings
          sub-screen is a surprise sign-out, and Settings has its own. */}
      {onJoined ? null : (
        <Button
          testID="code-screen-sign-out"
          variant="ghost"
          onPress={() => void signOut()}
        >
          <Text>{t('onboarding.code.signOut')}</Text>
        </Button>
      )}
    </SetupScreenShell>
  );
}

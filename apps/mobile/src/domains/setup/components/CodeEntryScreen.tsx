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
 * The invitee never explicitly picks "I'm a helper" — the JOIN path leads
 * here for both roles. Which household role they actually got (nanny, helper
 * or co-parent) is only known once the invite is redeemed, so THIS is where
 * the local wizard role is resolved and set; `stepsFor(role, 'join')` then
 * branches correctly for the remaining steps (helper skips availability and
 * calendar sync; nanny gets both).
 *
 * TWO ENTRY MODES, SUPPORTED EVERY TIME (D-50, spec §3.4). The mockups showed
 * the code already filled in, which raised the fair question of how the app
 * knew it. It does not, always:
 *   a — arrived by link (`/t/:code` handed it in as `initialCode`)
 *   b — opened on her own: empty field, autoFocus, and that is the DEFAULT
 *       assumption everywhere. Any state that only works when a code arrived
 *       by link is a bug.
 * Resolution order on mount, first hit wins: route param, then a pending deep
 * link replayed after sign-in, then (deferred, see below) the clipboard, then
 * nothing.
 *
 * PRE-FILLING NEVER AUTO-SUBMITS, and the field is never read-only. Redemption
 * is single-use (`claimPending`'s CAS), so auto-redeeming a mis-routed link
 * would burn a code nobody meant to spend; and a wrong or stale code has to be
 * correctable in place, or the only recovery is reinstalling the app.
 */
import {
  HOUSEHOLD_ROLES,
  HOUSEHOLD_STATES,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
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
import { AbsorptionConfirmSheet } from '@/src/domains/setup/components/AbsorptionConfirmSheet';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getNextSetupStep,
  getSetupStepRoute,
  getStepProgress,
  isSetupStepAfterCode,
  SETUP_PATHS,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useRedeemInvite } from '@/src/hooks/mutations/useRedeemInvite';
import { useUpdateName } from '@/src/hooks/mutations/useUpdateName';
import { useUpsertProfile } from '@/src/hooks/mutations/useUpsertProfile';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useInvitePreview } from '@/src/hooks/queries/useInvitePreview';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import {
  buildBootstrapProfileRequest,
  deriveBootstrapName,
} from '@/src/lib/bootstrapUserProfile';
import { getDeviceRegion } from '@/src/lib/deviceLocale';
import { useAuthStore } from '@/src/store/auth';
import { usePendingDeepLinkStore } from '@/src/store/pendingDeepLinkStore';
import { useSetupProgressStore } from '@/src/store/setupProgress';

/** `nanny.getsteadily.app/t/R4K-92T` -> `R4K-92T`. */
const DEEP_LINK_CODE_PATTERN = /\/t\/([A-Za-z0-9-]+)/;

export interface CodeEntryScreenProps {
  /**
   * SETTINGS ENTRY POINT (`/settings/join-household`). Presence of this
   * callback IS the variant switch: an ALREADY-ONBOARDED member — carer or
   * co-parent — redeeming a code for an ADDITIONAL household.
   *
   * The wizard step machine must NOT run for them. `setupProgress` is
   * MMKV-PERSISTED, and `app/onboarding/_layout.tsx` reads `role !== null`
   * as `wizardEngaged` to SUPPRESS its bounce-an-onboarded-user-out-of-the-
   * wizard guard. One `setRole` from here would disarm that guard for this
   * user on this device permanently.
   */
  onJoined?: (householdId: string) => void;
  /**
   * Mode (a): the code the OS handed us via `/t/:code`. Step 1 of §3.4's
   * resolution order; the route file reads the URL, this component owns the
   * rest of the order.
   */
  initialCode?: string;
}

/**
 * §3.4's resolution order, run ONCE as lazy `useState` init so a re-render
 * cannot re-consume the pending link or stomp what she has since typed.
 */
function resolveInitialCode(initialCode?: string): string {
  // 1. A code on the route params.
  if (initialCode) return initialCode;
  // 2. A link tapped while signed out, replayed once routing is ready.
  //    Already built, 10-minute TTL.
  const pending = usePendingDeepLinkStore.getState().consumePendingLink();
  const fromPending = pending?.match(DEEP_LINK_CODE_PATTERN)?.[1];
  if (fromPending) return fromPending;
  // 3. DELIBERATELY DEFERRED: the clipboard, when it matches XXX-XXX (§6.4
  //    step 2). It needs `expo-clipboard`, which is not installed and is a
  //    NATIVE dependency — adding it means a dev-client rebuild, and §6.4 is
  //    explicit that it should be added deliberately, not discovered. Nothing
  //    in this flow may DEPEND on it: the printed code (§6.2) is the floor and
  //    mode b below redeems it in six keystrokes.
  // 4. Nothing — mode b, and the default assumption everywhere.
  return '';
}

export function CodeEntryScreen({
  onJoined,
  initialCode,
}: CodeEntryScreenProps = {}) {
  const { t } = useTranslation('auth');
  const { t: tHousehold } = useTranslation('household');
  const router = useRouter();
  const role = useSetupProgressStore(s => s.role);
  const persistedPath = useSetupProgressStore(s => s.path);
  const persistedCurrentStep = useSetupProgressStore(s => s.currentStep);
  const setRole = useSetupProgressStore(s => s.setRole);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const signOut = useAuthStore(s => s.signOut);
  const authUser = useAuthStore(s => s.session?.user) ?? null;
  const [code, setCode] = useState(() => resolveInitialCode(initialCode));
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [isAbsorptionSheetOpen, setAbsorptionSheetOpen] = useState(false);
  const [hasRedeemed, setHasRedeemed] = useState(false);
  const [postRedeemError, setPostRedeemError] = useState<string | null>(null);

  // Reaching this screen at all IS the join path. `?? JOIN` covers the deep
  // link that jumps straight to CODE without passing the start fork.
  const path = persistedPath ?? SETUP_PATHS.JOIN;

  // Only remount recovery — not the in-flight redeem on this mount. Advancing
  // `currentStep` during `runJoin` must not swap the preview UI for the
  // resuming shell before navigation completes (or fails visibly).
  const mountedPastCode = useRef(
    !onJoined && isSetupStepAfterCode(role, path, persistedCurrentStep)
  );
  const isResumingPastCode = mountedPastCode.current;

  // Redeem invalidates memberships; the onboarding layout unmounts the Stack
  // while `useIsOnboarded` refetches. Persisted `currentStep` survives that
  // remount — resume immediately instead of showing an empty code form.
  useLayoutEffect(() => {
    if (!isResumingPastCode) return;
    router.replace(getSetupStepRoute(persistedCurrentStep) as Href);
  }, [isResumingPastCode, persistedCurrentStep, router]);

  const profile = useUserProfile();
  const upsertProfile = useUpsertProfile();
  const updateName = useUpdateName();
  const redeemInvite = useRedeemInvite();
  const households = useHouseholds();
  const isJoining =
    redeemInvite.isPending || upsertProfile.isPending || updateName.isPending;
  const lockInvitePreview = hasRedeemed || isJoining;
  const preview = useInvitePreview(submittedCode ?? '', {
    enabled: !lockInvitePreview,
  });

  // Untouched field falls back to the saved name, then to the same auth
  // derivation the parent bootstrap uses — never to an empty box.
  const name =
    nameDraft ??
    profile.data?.name ??
    (authUser ? deriveBootstrapName(authUser) : '');

  const onCheckCode = () => {
    if (!code.trim()) return;
    setPostRedeemError(null);
    setSubmittedCode(code.trim());
  };

  const invitePreview = preview.data;
  const showInvitePreview = Boolean(invitePreview);
  const showPreviewLookupError = preview.isError && !lockInvitePreview;

  // Someone who lands here without a code in hand used to be trapped: no
  // back, no sign-out. `replace`, not `back()` — StartScreen navigates here
  // with `router.replace`, which drops it from history, so a bare `back()`
  // would skip past the fork to whatever preceded it.
  const onBack = () => {
    // Settings variant: `back()` is correct here — this route was pushed onto
    // the private stack, not `replace`d over the wizard.
    if (onJoined) {
      router.back();
      return;
    }
    router.replace(getSetupStepRoute(SETUP_STEPS.START) as Href);
  };

  /**
   * §8.2 — a parent who ALREADY has a live household is redeeming a nanny's
   * DRAFT code. The nanny is absorbed into their family; nothing about that
   * family changes. Confirm BEFORE redemption completes, and with ≥2
   * households make the target an explicit choice, because otherwise
   * absorption silently picks one and the parent finds out later.
   *
   * No fork in the sheet: absorption is the only correct outcome (D-34), and
   * offering "create a separate household instead" would manufacture exactly
   * the duplicate-household mess D-34 exists to prevent.
   */
  const liveHouseholds = (households.data ?? []).filter(
    household => household.state === HOUSEHOLD_STATES.LIVE
  );
  const needsAbsorptionConfirm =
    invitePreview?.household_state === HOUSEHOLD_STATES.DRAFT &&
    liveHouseholds.length > 0;

  /** The actual redemption. `targetHouseholdId` is set only by the sheet. */
  const runJoin = (targetHouseholdId?: string) => {
    if (!submittedCode) return;
    const trimmedName = name.trim();

    void (async () => {
      let redeemed = false;
      try {
        setPostRedeemError(null);
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
        const membership = await redeemInvite.mutateAsync({
          code: submittedCode,
          ...(targetHouseholdId ? { targetHouseholdId } : {}),
          // D-8: a US-region device gets a Sunday-start pay week. Only the
          // server's INSTANTIATE branch reads it (096) — the case where a
          // parent with no household redeems a nanny's draft code and the
          // household is created right there. Nothing has ever set
          // `week_starts_on` on a draft, so without this the family takes the
          // SQL default of Monday and D-8 locks it at the first timesheet.
          // Same one-line shape as the parent create path
          // (`HouseholdScreen`/`ChildrenScreen`); every other region keeps
          // the default by omission.
          ...(getDeviceRegion() === 'US' ? { weekStartsOn: 0 } : {}),
        });
        redeemed = true;
        setHasRedeemed(true);
        // BEFORE the role/step resolution below — never write the persisted
        // wizard state for an already-onboarded user (see CodeEntryScreenProps).
        if (onJoined) {
          onJoined(membership.household_id);
          return;
        }
        // The redeemed membership, not the picked role, is the truth: a
        // co-parent invite grants server role 'parent', and a nanny-first draft
        // redeem (094 instantiate) grants 'owner'. This is the only moment the
        // app learns which of nanny / helper / co-parent / owner-parent it is.
        //
        // OWNER maps to SETUP_ROLES.PARENT: setup has no separate owner fork
        // (owner is a write-authority distinction on live households, not a
        // wizard path). Without this, draft redeem returned role=owner and
        // fell through to NANNY → Availability (Phase 6 Maestro B2).
        //
        // The old `?? NOTIFICATIONS_PERMISSION` fallback here existed ONLY
        // because `stepsForRole(PARENT)` had no CODE in it, so
        // `getNextSetupStep` returned null for a joining co-parent. CODE is
        // in every join sequence now (D-33), so all three roles chain
        // properly and the fallback is unreachable — kept as a total-function
        // guard, not as routing logic.
        const resolvedRole =
          membership.role === HOUSEHOLD_ROLES.HELPER
            ? SETUP_ROLES.HELPER
            : membership.role === HOUSEHOLD_ROLES.PARENT ||
                membership.role === HOUSEHOLD_ROLES.OWNER
              ? SETUP_ROLES.PARENT
              : SETUP_ROLES.NANNY;
        setRole(resolvedRole);
        const next =
          getNextSetupStep(resolvedRole, path, SETUP_STEPS.CODE) ??
          SETUP_STEPS.NOTIFICATIONS_PERMISSION;
        setCurrentStep(next);
        router.replace(getSetupStepRoute(next) as Href);
      } catch {
        if (redeemed) {
          setPostRedeemError(t('onboarding.code.postRedeemError'));
        }
        // Each mutation toasts its own failure; redeem also renders inline.
      }
    })();
  };

  const onJoin = () => {
    if (!submittedCode) return;
    if (!onJoined && !name.trim()) {
      setNameError(true);
      return;
    }
    if (needsAbsorptionConfirm) {
      setAbsorptionSheetOpen(true);
      return;
    }
    runJoin();
  };

  if (isResumingPastCode) {
    return (
      <SetupScreenShell
        testID="code-screen-resuming"
        progress={
          onJoined ? undefined : getStepProgress(role, path, SETUP_STEPS.CODE)
        }
        title={t('onboarding.code.title')}
        subtitle={t('onboarding.code.resumingSubtitle')}
        ctaLabel={t('common:continue')}
        ctaDisabled
        onCta={() => {}}
      >
        <LoadingIndicator />
      </SetupScreenShell>
    );
  }

  return (
    <SetupScreenShell
      testID="code-screen"
      progress={
        onJoined ? undefined : getStepProgress(role, path, SETUP_STEPS.CODE)
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
        showInvitePreview
          ? t('onboarding.code.joinHousehold')
          : t('common:continue')
      }
      ctaDisabled={showInvitePreview ? isJoining : code.trim().length === 0}
      onCta={showInvitePreview ? onJoin : onCheckCode}
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
            setHasRedeemed(false);
            setPostRedeemError(null);
          }}
          placeholder={t('onboarding.code.placeholder')}
          autoCapitalize="characters"
          // Never read-only, even when pre-filled: a wrong or stale code has
          // to be correctable in place (§3.4), or the only recovery from a
          // mis-routed link is reinstalling the app. `autoFocus` only when
          // there is nothing to read — a pre-filled field wants reading, not
          // a keyboard over it.
          autoFocus={Boolean(onJoined) || code.length === 0}
        />
      </View>

      {preview.isFetching ? <LoadingIndicator /> : null}

      {showPreviewLookupError ? (
        <FieldError testID="code-error">
          {t('onboarding.code.invalidError')}
        </FieldError>
      ) : null}

      {showInvitePreview && invitePreview ? (
        <Card testID="code-preview-card" className="gap-2 p-5.5">
          <H3 testID="code-preview-household">
            {invitePreview.household_name}
          </H3>
          {invitePreview.children_first_names.length > 0 ? (
            <Body
              testID="code-preview-children"
              className="text-muted-foreground"
            >
              {invitePreview.children_first_names.join(', ')}
            </Body>
          ) : null}
        </Card>
      ) : null}

      {redeemInvite.isError ? (
        <FieldError>{t('onboarding.code.redeemError')}</FieldError>
      ) : null}

      {postRedeemError ? (
        <FieldError testID="post-redeem-error">{postRedeemError}</FieldError>
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

      <AbsorptionConfirmSheet
        visible={isAbsorptionSheetOpen}
        carerName={invitePreview?.carer_name ?? null}
        households={liveHouseholds}
        isJoining={isJoining}
        onDismiss={() => setAbsorptionSheetOpen(false)}
        onConfirm={householdId => {
          setAbsorptionSheetOpen(false);
          // The chosen target goes straight into the redemption rather than
          // through state: a `setState` here would not have landed by the
          // time `runJoin` read it, and absorbing into the wrong family is
          // not a mistake a re-render can take back.
          runJoin(householdId);
        }}
      />
    </SetupScreenShell>
  );
}

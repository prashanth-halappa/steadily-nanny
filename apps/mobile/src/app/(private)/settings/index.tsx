/**
 * @module app/(private)/settings/index
 *
 * Route: `/settings`. Pushed from the `header-settings` icon on every root
 * screen (WP-C) — it used to be the fourth tab, but it is visited monthly
 * while the Inbox that replaced it is visited daily.
 */

import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
  HOUSEHOLD_STATES,
  PARENT_ROLES,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import Constants from 'expo-constants';
import { type Href, router } from 'expo-router';
import {
  Banknote,
  Bell,
  CalendarClock,
  CalendarOff,
  ChevronRight,
  Clock,
  DoorClosed,
  ExternalLink,
  FileText,
  HelpCircle,
  Home,
  KeyRound,
  type LucideIcon,
  PartyPopper,
  Shield,
  User,
  UserPlus,
  Users,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { SCREEN_CONTENT_STYLE, spacing } from '@/lib/design-tokens';
import { Icon } from '@/lib/icons/iconWithClassName';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { cn } from '@/lib/utils';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { IconChip, type IconChipTone } from '@/src/components/ui/icon-chip';
import { Input } from '@/src/components/ui/input';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { ScreenWash } from '@/src/components/ui/screen-wash';
import { Section } from '@/src/components/ui/section';
import { SkeletonShimmer } from '@/src/components/ui/skeleton-shimmer';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Body, H1, H3, H4, Small } from '@/src/components/ui/typography';
import { appIdentity } from '@/src/config/appIdentity';
import { HouseholdSwitcher } from '@/src/domains/household';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useDeleteAccount } from '@/src/hooks/mutations/useDeleteAccount';
import { useUpdatePreferredLocale } from '@/src/hooks/mutations/useUpdatePreferredLocale';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { SUPPORTED_LANGUAGES } from '@/src/i18n/constants';
import { useLanguageStore } from '@/src/i18n/languageStore';
import { useAuthStore } from '@/src/store/auth';
import { openExternalUrl } from '@/src/utils/openExternalUrl';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

// SETUP: point these at your real hosted legal pages.
const PRIVACY_URL = `https://${appIdentity.associatedDomain}/privacy`;
const TERMS_URL = `https://${appIdentity.associatedDomain}/terms`;
const HELP_URL = `mailto:help@${appIdentity.associatedDomain}`;

// Row height: 52, not the 44 touch minimum — a 14-row screen at the bare
// minimum reads as cramped (docs/design/01-LAWS.md).
const ROW_MIN_HEIGHT = 52;

function SettingsNavRow({
  testID,
  label,
  icon,
  tone,
  value,
  valuePending,
  onPress,
}: {
  testID: string;
  label: string;
  icon: LucideIcon;
  tone: IconChipTone;
  value?: string;
  valuePending?: boolean;
  onPress: () => void;
}) {
  return (
    <AnimatedPressable testID={testID} onPress={onPress}>
      <View
        className="flex-row items-center gap-3 px-4"
        style={{ minHeight: ROW_MIN_HEIGHT }}
      >
        <IconChip tone={tone} icon={icon} size="sm" />
        <Body className="flex-1 text-foreground">{label}</Body>
        {valuePending ? (
          <SkeletonShimmer
            testID={`${testID}-value-skeleton`}
            width={60}
            height={14}
          />
        ) : value ? (
          <Small className="text-muted-foreground" numberOfLines={1}>
            {value}
          </Small>
        ) : null}
        <Icon icon={ChevronRight} size={20} className="text-muted-foreground" />
      </View>
    </AnimatedPressable>
  );
}

function SettingsExternalRow({
  testID,
  label,
  icon,
  tone,
  onPress,
}: {
  testID: string;
  label: string;
  icon: LucideIcon;
  tone: IconChipTone;
  onPress: () => void;
}) {
  return (
    <AnimatedPressable testID={testID} onPress={onPress}>
      <View
        className="flex-row items-center gap-3 px-4"
        style={{ minHeight: ROW_MIN_HEIGHT }}
      >
        <IconChip tone={tone} icon={icon} size="sm" />
        <Body className="flex-1 text-foreground">{label}</Body>
        <Icon icon={ExternalLink} size={18} className="text-muted-foreground" />
      </View>
    </AnimatedPressable>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { refreshControl } = usePullToRefresh();
  const language = useLanguageStore(s => s.language);
  const setLanguage = useLanguageStore(s => s.setLanguage);
  const signOut = useAuthStore(s => s.signOut);
  const user = useAuthStore(s => s.user);
  const { mutateAsync: deleteAccount, isPending: isDeletingAccount } =
    useDeleteAccount();
  const updatePreferredLocale = useUpdatePreferredLocale();
  const profile = useUserProfile();
  const savedName = profile.data?.name ?? '';

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const accountEmail = user?.email ?? '';
  const deleteUnlocked =
    accountEmail.length > 0 &&
    deleteConfirmEmail.trim().toLowerCase() === accountEmail.toLowerCase();

  // Apply the language change locally FIRST and unconditionally (MMKV +
  // i18next re-render) — the app must switch language even offline or if
  // this network call fails. Persisting server-side is separate, best-effort:
  // a failed sync here shouldn't undo (or block) the change the user just saw
  // happen. See useUpdatePreferredLocale's header comment.
  const handleLanguageChange = (lang: (typeof SUPPORTED_LANGUAGES)[number]) => {
    void setLanguage(lang);
    updatePreferredLocale.mutate({ preferred_locale: lang });
  };
  // Server-derived role, NOT the local setupProgress store — that's
  // in-flight wizard UI state and can be empty/stale here (see
  // useIsOnboarded's header comment / TodayScreen for the same pattern).
  const onboarding = useIsOnboarded();
  const members = useHouseholdMembers(onboarding.householdId);

  const appVersion =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '—';

  // REVIEW-CHECKLIST.md §8 / App Store Guideline 5.1.1(v): the account must be
  // deletable in-app. On success, sign out and return to /welcome — a deleted
  // account has no session to keep around. On failure `useDeleteAccount`'s own
  // `onError` already toasts the user (see settings.deleteAccount.test.tsx —
  // fires on ANY mutateAsync rejection, network/5xx/timeout/contract-drift
  // alike, not just the F-B7-1 case) — don't ALSO toast here, that would
  // double up. Just stop before sign-out/nav, which belong to a genuine
  // success only. `signOut()` below can't itself throw and strand the
  // redirect — it swallows its own errors (see store/auth.ts's signOut).
  const confirmDeleteAccount = async () => {
    try {
      await deleteAccount();
    } catch (error) {
      if (__DEV__) console.error('[Settings] Account delete failed:', error);
      return;
    }
    await signOut();
    router.replace('/welcome' as Href);
  };

  const identityName = savedName || accountEmail;
  const showIdentitySkeleton = profile.isPending;
  const showIdentity = accountEmail || onboarding.role;
  const member = (members.data ?? []).find(m => m.user_id === user?.id);

  // The delete-account consequence sheet below: an active carer's hours are
  // hers to be named, not folded into "your household" (docs/design's
  // NAMES PEOPLE rule). Active only — a `removed` carer's own membership row
  // is gone, so there is no ongoing relationship left to disclose.
  const activeCarers = (members.data ?? []).filter(
    m =>
      m.role === HOUSEHOLD_ROLES.NANNY &&
      m.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE
  );
  const carerNames = activeCarers
    .map(m => resolveCarerName(m, t('settings:role.nanny')))
    .join(', ');
  // The two extra consequence lines (cancelled shifts, permanently-unapproved
  // weeks) are true only when deleting THIS account leaves nobody who can
  // write to the household at all — i.e. she is the last active owner/parent.
  // A co-parent staying behind means the household, and its ability to
  // approve a week, survives her deletion untouched.
  const activeWriteRoleMembers = (members.data ?? []).filter(
    m =>
      PARENT_ROLES.has(m.role) && m.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE
  );
  const isLastWriteRoleMember =
    !!member &&
    PARENT_ROLES.has(member.role) &&
    activeWriteRoleMembers.length === 1;
  const showCarerDeleteConsequences =
    isLastWriteRoleMember && activeCarers.length > 0;

  // Draft = a household she made to hold her own terms; she is its only
  // member and its author, so invite affordances belong to her here and
  // nowhere else.
  const isDraftAuthorNanny =
    onboarding.role === SETUP_ROLES.NANNY &&
    onboarding.householdState === HOUSEHOLD_STATES.DRAFT;
  const showHouseholdSection =
    onboarding.role === SETUP_ROLES.PARENT ||
    onboarding.role === SETUP_ROLES.NANNY ||
    onboarding.role === SETUP_ROLES.HELPER;

  return (
    <View className="flex-1 bg-background">
      <ScreenWash testID="settings-wash" kind="brand" />
      <ScrollView
        testID="settings-screen"
        className="flex-1"
        refreshControl={refreshControl}
        contentContainerStyle={SCREEN_CONTENT_STYLE}
      >
        <BackButton
          testID="settings-back"
          onPress={() => router.back()}
          label={t('common:back')}
        />
        {/* Hero band — no card, on the wash. The identity block used to sit
            mid-list in muted grey (docs/design/01-LAWS.md) — the one genuinely
            brand-level thing on the screen was the only block not in plum.
            This move inverts that back the right way round. */}
        <H1>{t('settings:title')}</H1>

        {showIdentitySkeleton ? (
          <View
            className="mt-4 flex-row items-center gap-3"
            testID="settings-identity-skeleton"
          >
            <SkeletonShimmer width={44} height={44} borderRadius={22} />
            <View className="flex-1 gap-2">
              <SkeletonShimmer width="60%" height={18} />
              <SkeletonShimmer width="40%" height={14} />
            </View>
          </View>
        ) : showIdentity ? (
          <View
            className="mt-4 flex-row items-center gap-3"
            testID="settings-identity"
          >
            <PersonAvatar
              name={identityName}
              colour={member?.colour ?? undefined}
              size="md"
            />
            <View className="flex-1 gap-1">
              <H4 testID="settings-identity-name">{identityName}</H4>
              {savedName && accountEmail ? (
                <Small className="text-muted-strong">{accountEmail}</Small>
              ) : null}
              {onboarding.role ? (
                <StatusPill
                  testID="settings-role"
                  variant="cancelled"
                  label={t(`settings:role.${onboarding.role}`)}
                />
              ) : null}
            </View>
          </View>
        ) : null}

        <View className="mt-8">
          {/* Household goes first for anyone who has one — it is the only
              group a person visits more than once a month
              (docs/design/01-LAWS.md). */}
          {showHouseholdSection ? (
            <Section
              title={t('settings:household')}
              first
              testID="settings-household-section"
            >
              {/* Renders nothing for one household (every parent, most
                  nannies) — see HouseholdSwitcher's header comment. Its own
                  pill styling doesn't fit the row geometry below, so it sits
                  above the card rather than inside it. */}
              <HouseholdSwitcher />
              <Card tone="default" className="overflow-hidden p-0">
                {onboarding.role === SETUP_ROLES.PARENT ? (
                  <>
                    <SettingsNavRow
                      testID="settings-manage-children"
                      label={t('household:children.manageTitle')}
                      icon={Users}
                      tone="schedule"
                      onPress={() => router.push('/settings/children' as Href)}
                    />
                    <SettingsNavRow
                      testID="settings-invite-nanny"
                      label={t('household:invite.manageTitle')}
                      icon={UserPlus}
                      tone="schedule"
                      onPress={() => router.push('/settings/invite' as Href)}
                    />
                    <SettingsNavRow
                      testID="settings-invite-codes"
                      label={t('household:invites.title')}
                      icon={UserPlus}
                      tone="schedule"
                      onPress={() => router.push('/settings/invites' as Href)}
                    />
                    <SettingsNavRow
                      testID="settings-manage-household"
                      label={t('household:householdSettings.manageTitle')}
                      icon={Home}
                      tone="schedule"
                      onPress={() => router.push('/settings/household' as Href)}
                    />
                    <SettingsNavRow
                      testID="settings-pay"
                      label={t('pay:title')}
                      icon={Banknote}
                      tone="hours"
                      onPress={() => router.push('/settings/pay' as Href)}
                    />
                    <SettingsNavRow
                      testID="settings-view-availability"
                      label={t('settings:carerAvailability')}
                      icon={CalendarClock}
                      tone="schedule"
                      onPress={() =>
                        router.push('/settings/carer-availability' as Href)
                      }
                    />
                    <SettingsNavRow
                      testID="settings-view-time-off"
                      label={t('settings:carerTimeOff')}
                      icon={CalendarOff}
                      tone="schedule"
                      onPress={() =>
                        router.push('/settings/household-time-off' as Href)
                      }
                    />
                    <SettingsNavRow
                      testID="settings-household-closures"
                      label={t('household:closures.manageTitle')}
                      icon={DoorClosed}
                      tone="schedule"
                      onPress={() =>
                        router.push('/settings/household-closures' as Href)
                      }
                    />
                    <SettingsNavRow
                      testID="settings-household-holidays"
                      label={t('household:holidays.manageTitle')}
                      icon={PartyPopper}
                      tone="schedule"
                      onPress={() =>
                        router.push('/settings/household-holidays' as Href)
                      }
                    />
                  </>
                ) : (
                  <>
                    {/* S9 / direction §4 — her map of where she works: the
                        family's address and who to call, above everything
                        else on the screen. */}
                    <SettingsNavRow
                      testID="settings-this-family"
                      label={t('household:thisFamily.navLabel')}
                      icon={Home}
                      tone="schedule"
                      onPress={() =>
                        router.push('/settings/this-family' as Href)
                      }
                    />
                    {/* A past member's household has ended for her — nobody
                        reads an availability she can no longer offer, so the
                        row would only dead-end her. Household holidays and
                        My pay below stay: they still show her something of
                        her own. */}
                    {!onboarding.isPastMember ? (
                      <SettingsNavRow
                        testID="settings-manage-availability"
                        label={t('household:availability.manageTitle')}
                        icon={CalendarClock}
                        tone="schedule"
                        onPress={() =>
                          router.push('/settings/availability' as Href)
                        }
                      />
                    ) : null}
                    {/* Nanny only — a helper has no access to pay at all
                        (docs/TIER0-CX-SPEC.md §8 "Helper role"). */}
                    {onboarding.role === SETUP_ROLES.NANNY ? (
                      <>
                        <SettingsNavRow
                          testID="settings-my-pay"
                          label={t('pay:myPay.title')}
                          icon={Banknote}
                          tone="hours"
                          onPress={() =>
                            router.push('/settings/my-pay' as Href)
                          }
                        />
                        <SettingsNavRow
                          testID="settings-household-holidays"
                          label={t('household:holidays.manageTitle')}
                          icon={PartyPopper}
                          tone="schedule"
                          onPress={() =>
                            router.push('/settings/household-holidays' as Href)
                          }
                        />
                      </>
                    ) : null}
                    {/* The nanny who AUTHORED a draft household is its write
                        authority — the server says so (`assertWriteRoleOrDraft
                        Author`), the client did not: both invite rows sit in
                        the parent-only arm above, so the ONE place in the app
                        she could invite a family was a single button on the
                        draft home. When that button was disabled she had no
                        route at all, which is exactly where a real nanny got
                        stuck. Draft-only: a nanny inside somebody's live
                        family invites nobody. */}
                    {isDraftAuthorNanny ? (
                      <SettingsNavRow
                        testID="settings-draft-invites"
                        label={t('household:invites.title')}
                        icon={UserPlus}
                        tone="schedule"
                        onPress={() => router.push('/settings/invites' as Href)}
                      />
                    ) : null}
                    {/* Same reasoning as Availability above — TimeOffScreen
                        itself already refuses a past member outright, so a
                        row that leads there for her is a dead end, not a
                        record. */}
                    {!onboarding.isPastMember ? (
                      <SettingsNavRow
                        testID="settings-request-time-off"
                        label={t('timeOff:screenTitle')}
                        icon={CalendarOff}
                        tone="schedule"
                        onPress={() =>
                          router.push('/settings/time-off' as Href)
                        }
                      />
                    ) : null}
                  </>
                )}
                {/* OUTSIDE the role ternary on purpose — every role can be
                    invited by a second family (a carer working for two
                    households, a co-parent joining one). Without this row
                    that invite code has nowhere to be typed:
                    `/onboarding/code` is sealed off the moment
                    `useIsOnboarded` says onboarded. Last in the group
                    because it is an occasional action, not a daily one. */}
                <SettingsNavRow
                  testID="settings-join-household"
                  label={t('household:invite.joinTitle')}
                  icon={KeyRound}
                  tone="schedule"
                  onPress={() =>
                    router.push('/settings/join-household' as Href)
                  }
                />
              </Card>
            </Section>
          ) : null}

          {/* Account before Language — the finding called out Language
              outranking Account. Time + OS notifications live here;
              identity moved to the hero band above. */}
          <Section
            title={t('settings:account')}
            first={!showHouseholdSection}
            testID="settings-account-section"
          >
            <Card tone="default" className="overflow-hidden p-0">
              <SettingsNavRow
                testID="settings-name-row"
                label={t('settings:name.label')}
                icon={User}
                tone="brand"
                value={savedName || undefined}
                valuePending={profile.isPending}
                onPress={() => router.push('/settings/edit-name' as Href)}
              />
              <SettingsNavRow
                testID="settings-time"
                label={t('settings:time.menuLabel')}
                icon={Clock}
                tone="brand"
                onPress={() => router.push('/settings/time' as Href)}
              />
              <SettingsNavRow
                testID="settings-notifications"
                label={t('settings:notifications')}
                icon={Bell}
                tone="brand"
                onPress={() => router.push('/settings/notifications' as Href)}
              />
            </Card>
          </Section>

          <Section
            title={t('settings:language')}
            testID="settings-language-section"
          >
            <View
              className="flex-row rounded-chip p-1"
              style={{ backgroundColor: colors.chip.plum }}
            >
              {SUPPORTED_LANGUAGES.map(lang => {
                const selected = lang === language;
                return (
                  <AnimatedPressable
                    key={lang}
                    testID={`settings-language-${lang}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => handleLanguageChange(lang)}
                    style={{ flex: 1, minHeight: spacing.minTouchTarget }}
                  >
                    <View
                      className={cn(
                        'flex-1 items-center justify-center rounded-chip',
                        selected && 'bg-primary'
                      )}
                    >
                      <Small
                        className={cn(
                          'font-semibold',
                          selected
                            ? 'text-primary-foreground'
                            : 'text-foreground'
                        )}
                      >
                        {t(`settings:languageNames.${lang}`)}
                      </Small>
                    </View>
                  </AnimatedPressable>
                );
              })}
            </View>
          </Section>

          <Section title={t('settings:legal')} testID="settings-legal-section">
            <Card tone="default" className="overflow-hidden p-0">
              <SettingsExternalRow
                testID="settings-privacy"
                label={t('settings:privacyPolicy')}
                icon={Shield}
                tone="people"
                onPress={() => void openExternalUrl(PRIVACY_URL)}
              />
              <SettingsExternalRow
                testID="settings-terms"
                label={t('settings:termsOfService')}
                icon={FileText}
                tone="people"
                onPress={() => void openExternalUrl(TERMS_URL)}
              />
              <SettingsExternalRow
                testID="settings-get-help"
                label={t('settings:getHelp')}
                icon={HelpCircle}
                tone="people"
                onPress={() => void openExternalUrl(HELP_URL)}
              />
            </Card>
          </Section>
        </View>

        <Button
          testID="settings-sign-out"
          variant="outline"
          className="mt-8"
          onPress={() => void signOut()}
        >
          <Text>{t('settings:signOut')}</Text>
        </Button>

        {/* Delete-account confirm hosts a required email Input — must use
            BottomSheetBase (keyboard-aware), never AlertDialog. AlertDialog
            has no KeyboardAvoidingView/ScrollView; on device the keyboard
            covers Cancel + confirm and the flow is uncompletable (App Store
            Guideline 5.1.1(v)). Same migration as ReopenWeekDialog. */}
        <Button
          testID="settings-delete-account"
          variant="ghost"
          className="mt-4"
          onPress={() => setDeleteOpen(true)}
        >
          <Text className="text-error-inline-text">
            {t('settings:deleteAccount')}
          </Text>
        </Button>

        <Small
          testID="settings-app-version"
          className="mt-4 text-center text-muted-foreground"
        >
          {t('settings:appVersion', { version: appVersion })}
        </Small>

        <BottomSheetBase
          sheetId="settings-delete-account"
          visible={deleteOpen}
          onDismiss={() => setDeleteOpen(false)}
          fitContent
          showCloseButton
        >
          <View
            className="gap-4 pb-4"
            style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
          >
            <H3>{t('settings:deleteAccountConfirmTitle')}</H3>
            <Body className="text-muted-foreground">
              {t('settings:deleteAccountConfirmBody')}
            </Body>
            <View className="gap-1">
              <Body className="text-muted-strong">
                • {t('settings:deleteAccountConsequenceAccount')}
              </Body>
              <Body className="text-muted-strong">
                •{' '}
                {/* Literal `t()` per branch, never a ternary INSIDE `t(...)`
                    — the second key is invisible to the locale-key guard that
                    way (the same trap `ClockInBlockedCard` names). */}
                {activeCarers.length > 0
                  ? t('settings:deleteAccountConsequenceKeeps', {
                      names: carerNames,
                    })
                  : t('settings:deleteAccountConsequenceKeepsGeneric')}
              </Body>
              {showCarerDeleteConsequences ? (
                <>
                  <Body
                    testID="settings-delete-consequence-carer"
                    className="text-muted-strong"
                  >
                    •{' '}
                    {t('settings:deleteAccountConsequenceCarer', {
                      count: activeCarers.length,
                      names: carerNames,
                    })}
                  </Body>
                  <Body
                    testID="settings-delete-consequence-approval"
                    className="text-muted-strong"
                  >
                    • {t('settings:deleteAccountConsequenceApproval')}
                  </Body>
                </>
              ) : null}
            </View>
            {accountEmail ? (
              <View className="gap-2">
                <Small className="text-muted-foreground">
                  {t('settings:deleteAccountTypeEmail')}
                </Small>
                <Input
                  testID="settings-delete-confirm-email"
                  accessibilityLabel={t('settings:deleteAccountTypeEmail')}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={deleteConfirmEmail}
                  onChangeText={setDeleteConfirmEmail}
                  placeholder={accountEmail}
                />
              </View>
            ) : null}
            <View className="gap-2">
              <Button variant="outline" onPress={() => setDeleteOpen(false)}>
                <Text>{t('settings:deleteAccountCancel')}</Text>
              </Button>
              <Button
                testID="settings-delete-account-confirm"
                variant="destructive"
                disabled={
                  isDeletingAccount ||
                  (accountEmail.length > 0 && !deleteUnlocked)
                }
                onPress={() => void confirmDeleteAccount()}
              >
                <Text>{t('settings:deleteAccountConfirm')}</Text>
              </Button>
            </View>
          </View>
        </BottomSheetBase>

        {/* Dev-only entry point to the verification cockpit. */}
        {__DEV__ ? (
          <AnimatedPressable
            testID="settings-debug-link"
            onPress={() => router.push('/debug' as Href)}
          >
            <Body className="mt-6 text-primary">
              Debug / verification cockpit
            </Body>
          </AnimatedPressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

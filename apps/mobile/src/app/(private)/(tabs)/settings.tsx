/**
 * @module app/(private)/(tabs)/settings
 */

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
  Inbox,
  KeyRound,
  type LucideIcon,
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
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { cn } from '@/lib/utils';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { IconChip, type IconChipTone } from '@/src/components/ui/icon-chip';
import { Input } from '@/src/components/ui/input';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { ScreenWash } from '@/src/components/ui/screen-wash';
import { SkeletonShimmer } from '@/src/components/ui/skeleton-shimmer';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import {
  Body,
  H1,
  H3,
  H4,
  MetadataLabel,
  Small,
} from '@/src/components/ui/typography';
import { appIdentity } from '@/src/config/appIdentity';
import { HouseholdSwitcher } from '@/src/domains/household';
import { useInboxItems } from '@/src/domains/inbox';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useDeleteAccount } from '@/src/hooks/mutations/useDeleteAccount';
import { useUpdatePreferredLocale } from '@/src/hooks/mutations/useUpdatePreferredLocale';
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
// minimum reads as cramped (daylight-v2.md §2.1).
const ROW_MIN_HEIGHT = 52;

function SettingsNavRow({
  testID,
  label,
  icon,
  tone,
  value,
  valuePending,
  valueBadge,
  onPress,
}: {
  testID: string;
  label: string;
  icon: LucideIcon;
  tone: IconChipTone;
  value?: string;
  valuePending?: boolean;
  /** Renders as a filled chipPlum pill instead of plain text — reserved for
   * the one actionable value on the screen (the inbox count). */
  valueBadge?: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <AnimatedPressable testID={testID} onPress={onPress}>
      <View
        className="flex-row items-center gap-3 px-4"
        style={{ minHeight: ROW_MIN_HEIGHT }}
      >
        <IconChip tone={tone} icon={icon} size="sm" />
        <Body className="flex-1 text-foreground">{label}</Body>
        {valueBadge ? (
          <View
            className="rounded-chip px-2 py-0.5"
            style={{ backgroundColor: colors.chip.plum }}
          >
            <Small className="font-semibold text-primary">{valueBadge}</Small>
          </View>
        ) : valuePending ? (
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
  // The floating tab bar overlays this screen's content rather than
  // reserving its own layout space (React Navigation bottom-tabs default —
  // see useTabBarScrollPadding's header comment); without this, a row that
  // ends up under the bar is a permanent dead zone: taps land on the tab
  // bar underneath instead of the row.
  const tabBarScrollPadding = useTabBarScrollPadding();
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
  const inbox = useInboxItems();
  const inboxBadge =
    inbox.items.length > 0 ? String(inbox.items.length) : undefined;

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

  return (
    <View className="flex-1 bg-background">
      <ScreenWash testID="settings-wash" kind="brand" />
      <ScrollView
        testID="settings-screen"
        className="flex-1"
        contentContainerStyle={{
          ...SCREEN_CONTENT_STYLE,
          paddingBottom: tabBarScrollPadding,
        }}
      >
        {/* Hero band — no card, on the wash. The identity block used to sit
            mid-list in muted grey (daylight-v2.md §1) — the one genuinely
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
            <PersonAvatar name={identityName} size="md" />
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

        <View className="mt-8 gap-6">
          {/* Household goes first for anyone who has one — it is the only
              group a person visits more than once a month
              (daylight-v2.md §2.2). */}
          {onboarding.role === SETUP_ROLES.PARENT ||
          onboarding.role === SETUP_ROLES.NANNY ||
          onboarding.role === SETUP_ROLES.HELPER ? (
            <View className="gap-3" testID="settings-household-section">
              <MetadataLabel className="text-muted-foreground">
                {t('settings:household')}
              </MetadataLabel>
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
                    <SettingsNavRow
                      testID="settings-manage-availability"
                      label={t('household:availability.manageTitle')}
                      icon={CalendarClock}
                      tone="schedule"
                      onPress={() =>
                        router.push('/settings/availability' as Href)
                      }
                    />
                    {/* Nanny only — a helper has no access to pay at all
                        (docs/TIER0-CX-SPEC.md §8 "Helper role"). */}
                    {onboarding.role === SETUP_ROLES.NANNY ? (
                      <SettingsNavRow
                        testID="settings-my-pay"
                        label={t('pay:myPay.title')}
                        icon={Banknote}
                        tone="hours"
                        onPress={() => router.push('/settings/my-pay' as Href)}
                      />
                    ) : null}
                    <SettingsNavRow
                      testID="settings-request-time-off"
                      label={t('timeOff:screenTitle')}
                      icon={CalendarOff}
                      tone="schedule"
                      onPress={() => router.push('/settings/time-off' as Href)}
                    />
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
            </View>
          ) : null}

          {/* Account before Language — the finding called out Language
              outranking Account. Time + OS notifications live here;
              identity moved to the hero band above. */}
          <View className="gap-3" testID="settings-account-section">
            <MetadataLabel className="text-muted-foreground">
              {t('settings:account')}
            </MetadataLabel>
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
                testID="settings-inbox"
                label={t('settings:inbox')}
                icon={Inbox}
                tone="brand"
                valueBadge={inboxBadge}
                onPress={() => router.push('/inbox' as Href)}
              />
              <SettingsNavRow
                testID="settings-notifications"
                label={t('settings:notifications')}
                icon={Bell}
                tone="brand"
                onPress={() => router.push('/settings/notifications' as Href)}
              />
            </Card>
          </View>

          <View className="gap-3" testID="settings-language-section">
            <MetadataLabel className="text-muted-foreground">
              {t('settings:language')}
            </MetadataLabel>
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
          </View>

          <View className="gap-3" testID="settings-legal-section">
            <MetadataLabel className="text-muted-foreground">
              {t('settings:legal')}
            </MetadataLabel>
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
          </View>
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
          <Text className="text-destructive">
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
                • {t('settings:deleteAccountConsequenceKeeps')}
              </Body>
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

/**
 * @module app/(private)/(tabs)/settings
 */

import Constants from 'expo-constants';
import { type Href, router } from 'expo-router';
import { ChevronRight, ExternalLink } from 'lucide-react-native';
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
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Body, H1, H4, Small } from '@/src/components/ui/typography';
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
import { useElevation } from '~/lib/design-tokens/elevation';

// SETUP: point these at your real hosted legal pages.
const PRIVACY_URL = `https://${appIdentity.associatedDomain}/privacy`;
const TERMS_URL = `https://${appIdentity.associatedDomain}/terms`;
const HELP_URL = `mailto:help@${appIdentity.associatedDomain}`;

function SettingsNavRow({
  testID,
  label,
  value,
  onPress,
}: {
  testID: string;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const elevation = useElevation();
  return (
    <AnimatedPressable testID={testID} onPress={onPress}>
      <View
        className="flex-row items-center justify-between gap-3 rounded-row bg-card px-4"
        style={[
          {
            minHeight: spacing.minTouchTarget,
          },
          elevation.row,
        ]}
      >
        <Body className="flex-1 text-primary">{label}</Body>
        {value ? (
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
  onPress,
}: {
  testID: string;
  label: string;
  onPress: () => void;
}) {
  const elevation = useElevation();
  return (
    <AnimatedPressable testID={testID} onPress={onPress}>
      <View
        className="flex-row items-center justify-between gap-3 rounded-row bg-card px-4"
        style={[
          {
            minHeight: spacing.minTouchTarget,
          },
          elevation.row,
        ]}
      >
        <Body className="flex-1 text-primary">{label}</Body>
        <Icon icon={ExternalLink} size={18} className="text-muted-foreground" />
      </View>
    </AnimatedPressable>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
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

  return (
    <ScrollView
      testID="settings-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{
        ...SCREEN_CONTENT_STYLE,
        paddingBottom: tabBarScrollPadding,
      }}
    >
      <H1>{t('settings:title')}</H1>

      {accountEmail || onboarding.role ? (
        <View className="mt-4 gap-1" testID="settings-identity">
          {accountEmail ? (
            <Body className="text-muted-foreground">{accountEmail}</Body>
          ) : null}
          {onboarding.role ? (
            <Small className="text-muted-foreground" testID="settings-role">
              {t(`settings:role.${onboarding.role}`)}
            </Small>
          ) : null}
        </View>
      ) : null}

      {/* Account before Language — the finding called out Language outranking
          Account. Time + OS notifications live here; identity sits above. */}
      <View className="mt-8 gap-3" testID="settings-account-section">
        <H4>{t('settings:account')}</H4>
        <View className="gap-2">
          <SettingsNavRow
            testID="settings-name-row"
            label={t('settings:name.label')}
            value={savedName || undefined}
            onPress={() => router.push('/settings/edit-name' as Href)}
          />
        </View>
        <SettingsNavRow
          testID="settings-time"
          label={t('settings:time.menuLabel')}
          onPress={() => router.push('/settings/time' as Href)}
        />
        <SettingsNavRow
          testID="settings-inbox"
          label={t('settings:inbox')}
          value={inboxBadge}
          onPress={() => router.push('/inbox' as Href)}
        />
        <SettingsNavRow
          testID="settings-notifications"
          label={t('settings:notifications')}
          onPress={() => router.push('/settings/notifications' as Href)}
        />
      </View>

      <View className="mt-8 gap-3" testID="settings-language-section">
        <H4>{t('settings:language')}</H4>
        <View className="flex-row flex-wrap gap-2">
          {SUPPORTED_LANGUAGES.map(lang => (
            <AnimatedPressable
              key={lang}
              testID={`settings-language-${lang}`}
              onPress={() => handleLanguageChange(lang)}
              style={{
                minHeight: spacing.minTouchTarget,
                justifyContent: 'center',
              }}
            >
              <Small
                className={cn(
                  'rounded-chip border px-4 py-2',
                  lang === language
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground'
                )}
              >
                {lang.toUpperCase()}
              </Small>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      {onboarding.role === SETUP_ROLES.PARENT ||
      onboarding.role === SETUP_ROLES.NANNY ||
      onboarding.role === SETUP_ROLES.HELPER ? (
        <View className="mt-8 gap-3" testID="settings-household-section">
          <H4>{t('settings:household')}</H4>
          {/* Renders nothing for one household (every parent, most nannies)
              — see HouseholdSwitcher's header comment. */}
          <HouseholdSwitcher />
          {onboarding.role === SETUP_ROLES.PARENT ? (
            <>
              <SettingsNavRow
                testID="settings-manage-children"
                label={t('household:children.manageTitle')}
                onPress={() => router.push('/settings/children' as Href)}
              />
              <SettingsNavRow
                testID="settings-invite-nanny"
                label={t('household:invite.manageTitle')}
                onPress={() => router.push('/settings/invite' as Href)}
              />
              <SettingsNavRow
                testID="settings-manage-household"
                label={t('household:householdSettings.manageTitle')}
                onPress={() => router.push('/settings/household' as Href)}
              />
              <SettingsNavRow
                testID="settings-pay"
                label={t('pay:title')}
                onPress={() => router.push('/settings/pay' as Href)}
              />
              <SettingsNavRow
                testID="settings-view-availability"
                label={t('settings:carerAvailability')}
                onPress={() =>
                  router.push('/settings/carer-availability' as Href)
                }
              />
              <SettingsNavRow
                testID="settings-view-time-off"
                label={t('settings:carerTimeOff')}
                onPress={() =>
                  router.push('/settings/household-time-off' as Href)
                }
              />
              <SettingsNavRow
                testID="settings-household-closures"
                label={t('household:closures.manageTitle')}
                onPress={() =>
                  router.push('/settings/household-closures' as Href)
                }
              />
            </>
          ) : (
            <>
              <SettingsNavRow
                testID="settings-manage-availability"
                label={t('household:availability.manageTitle')}
                onPress={() => router.push('/settings/availability' as Href)}
              />
              {/* Nanny only — a helper has no access to pay at all
                  (docs/TIER0-CX-SPEC.md §8 "Helper role"). */}
              {onboarding.role === SETUP_ROLES.NANNY ? (
                <SettingsNavRow
                  testID="settings-my-pay"
                  label={t('pay:myPay.title')}
                  onPress={() => router.push('/settings/my-pay' as Href)}
                />
              ) : null}
              <SettingsNavRow
                testID="settings-request-time-off"
                label={t('timeOff:screenTitle')}
                onPress={() => router.push('/settings/time-off' as Href)}
              />
            </>
          )}
          {/* OUTSIDE the role ternary on purpose — every role can be invited
              by a second family (a carer working for two households, a
              co-parent joining one). Without this row that invite code has
              nowhere to be typed: `/onboarding/code` is sealed off the moment
              `useIsOnboarded` says onboarded. Last in the section because it
              is an occasional action, not a daily one. */}
          <SettingsNavRow
            testID="settings-join-household"
            label={t('household:invite.joinTitle')}
            onPress={() => router.push('/settings/join-household' as Href)}
          />
        </View>
      ) : null}

      <View className="mt-8 gap-3" testID="settings-legal-section">
        <H4>{t('settings:legal')}</H4>
        <SettingsExternalRow
          testID="settings-privacy"
          label={t('settings:privacyPolicy')}
          onPress={() => void openExternalUrl(PRIVACY_URL)}
        />
        <SettingsExternalRow
          testID="settings-terms"
          label={t('settings:termsOfService')}
          onPress={() => void openExternalUrl(TERMS_URL)}
        />
        <SettingsExternalRow
          testID="settings-get-help"
          label={t('settings:getHelp')}
          onPress={() => void openExternalUrl(HELP_URL)}
        />
        <Small testID="settings-app-version" className="text-muted-foreground">
          {t('settings:appVersion', { version: appVersion })}
        </Small>
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
        <Text className="text-destructive">{t('settings:deleteAccount')}</Text>
      </Button>
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
          <H4>{t('settings:deleteAccountConfirmTitle')}</H4>
          <Body className="text-muted-foreground">
            {t('settings:deleteAccountConfirmBody')}
          </Body>
          <View className="gap-1">
            <Small className="text-muted-foreground">
              • {t('settings:deleteAccountConsequenceAccount')}
            </Small>
            <Small className="text-muted-foreground">
              • {t('settings:deleteAccountConsequenceKeeps')}
            </Small>
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
  );
}

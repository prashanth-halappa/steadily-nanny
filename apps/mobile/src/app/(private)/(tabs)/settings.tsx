/**
 * @module app/(private)/(tabs)/settings
 */
import { type Href, router } from 'expo-router';
import { ChevronRight, ExternalLink } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { SCREEN_CONTENT_STYLE, spacing } from '@/lib/design-tokens';
import { Icon } from '@/lib/icons/iconWithClassName';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/src/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Text } from '@/src/components/ui/text';
import { Body, H1, H4, Small } from '@/src/components/ui/typography';
import { appIdentity } from '@/src/config/appIdentity';
import { HouseholdSwitcher } from '@/src/domains/household';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useDeleteAccount } from '@/src/hooks/mutations/useDeleteAccount';
import { useUpdateName } from '@/src/hooks/mutations/useUpdateName';
import { useUpdatePreferredLocale } from '@/src/hooks/mutations/useUpdatePreferredLocale';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { SUPPORTED_LANGUAGES } from '@/src/i18n/constants';
import { useLanguageStore } from '@/src/i18n/languageStore';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import { openExternalUrl } from '@/src/utils/openExternalUrl';
import { useElevation } from '~/lib/design-tokens/elevation';

// SETUP: point these at your real hosted legal pages.
const PRIVACY_URL = `https://${appIdentity.associatedDomain}/privacy`;
const TERMS_URL = `https://${appIdentity.associatedDomain}/terms`;

function SettingsNavRow({
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
  const language = useLanguageStore(s => s.language);
  const setLanguage = useLanguageStore(s => s.setLanguage);
  const signOut = useAuthStore(s => s.signOut);
  const user = useAuthStore(s => s.user);
  const { mutateAsync: deleteAccount, isPending: isDeletingAccount } =
    useDeleteAccount();
  const updatePreferredLocale = useUpdatePreferredLocale();
  const profile = useUserProfile();
  const updateName = useUpdateName();
  // null = untouched, so the field tracks the server value until the user
  // edits it — no seeding effect, and a background refetch can't clobber an
  // edit in progress.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const savedName = profile.data?.name ?? '';
  const nameValue = nameDraft ?? savedName;
  const isNameDirty =
    nameDraft !== null &&
    nameDraft.trim().length > 0 &&
    nameDraft.trim() !== savedName;

  const handleSaveName = async () => {
    try {
      await updateName.mutateAsync({ name: nameValue.trim() });
      setNameDraft(null);
      showSuccessToast(t('settings:name.savedToast'));
    } catch {
      // useUpdateName's onError already surfaced a toast.
    }
  };

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

  // REVIEW-CHECKLIST.md §8 / App Store Guideline 5.1.1(v): the account must be
  // deletable in-app. On success, sign out and return to /welcome — a deleted
  // account has no session to keep around. On failure the mutation's onError
  // already surfaced a toast, so just stop here without signing out.
  const confirmDeleteAccount = async () => {
    try {
      await deleteAccount();
    } catch {
      return;
    }
    await signOut();
    router.replace('/welcome' as Href);
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <H1>{t('settings:title')}</H1>

      {accountEmail || onboarding.role ? (
        <View className="mt-4 gap-1" testID="settings-identity">
          {accountEmail ? (
            <Body className="text-muted-foreground">{accountEmail}</Body>
          ) : null}
          {onboarding.role ? (
            <Small className="text-muted-foreground" testID="settings-role">
              {onboarding.role}
            </Small>
          ) : null}
        </View>
      ) : null}

      {/* Account before Language — the finding called out Language outranking
          Account. Time + OS notifications live here; identity sits above. */}
      <View className="mt-8 gap-3" testID="settings-account-section">
        <H4>{t('settings:account')}</H4>
        <View className="gap-2">
          <Label>{t('settings:name.label')}</Label>
          <Input
            testID="settings-name-input"
            accessibilityLabel={t('settings:name.label')}
            value={nameValue}
            onChangeText={setNameDraft}
            placeholder={t('settings:name.placeholder')}
          />
          {isNameDirty ? (
            <Button
              testID="settings-name-save"
              size="sm"
              disabled={updateName.isPending}
              onPress={() => void handleSaveName()}
            >
              <Text>{t('settings:name.saveButton')}</Text>
            </Button>
          ) : null}
        </View>
        <SettingsNavRow
          testID="settings-time"
          label={t('settings:time.menuLabel')}
          onPress={() => router.push('/settings/time' as Href)}
        />
        <SettingsExternalRow
          testID="settings-notifications"
          label={t('settings:notifications')}
          onPress={() => void Linking.openSettings()}
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
            </>
          ) : (
            <>
              <SettingsNavRow
                testID="settings-manage-availability"
                label={t('household:availability.manageTitle')}
                onPress={() => router.push('/settings/availability' as Href)}
              />
              <SettingsNavRow
                testID="settings-request-time-off"
                label={t('timeOff:screenTitle')}
                onPress={() => router.push('/settings/time-off' as Href)}
              />
            </>
          )}
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
      </View>

      <Button
        testID="settings-sign-out"
        variant="outline"
        className="mt-8"
        onPress={() => void signOut()}
      >
        <Text>{t('settings:signOut')}</Text>
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            testID="settings-delete-account"
            variant="ghost"
            className="mt-4"
          >
            <Text className="text-destructive">
              {t('settings:deleteAccount')}
            </Text>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings:deleteAccountConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings:deleteAccountConfirmBody')}
            </AlertDialogDescription>
            <View className="mt-2 gap-1">
              <Body className="text-sm text-muted-foreground">
                • {t('settings:deleteAccountConsequenceAccount')}
              </Body>
              <Body className="text-sm text-muted-foreground">
                • {t('settings:deleteAccountConsequenceKeeps')}
              </Body>
            </View>
            {accountEmail ? (
              <View className="mt-3 gap-2">
                <Body className="text-sm text-muted-foreground">
                  {t('settings:deleteAccountTypeEmail')}
                </Body>
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
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>{t('settings:deleteAccountCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="settings-delete-account-confirm"
              className={buttonVariants({ variant: 'destructive' })}
              disabled={
                isDeletingAccount ||
                (accountEmail.length > 0 && !deleteUnlocked)
              }
              onPress={() => void confirmDeleteAccount()}
            >
              <Text className="text-destructive-foreground">
                {t('settings:deleteAccountConfirm')}
              </Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

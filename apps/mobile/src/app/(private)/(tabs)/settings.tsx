/**
 * @module app/(private)/(tabs)/settings
 */
import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
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
import { Text } from '@/src/components/ui/text';
import { Body, H1, H4, Small } from '@/src/components/ui/typography';
import { appIdentity } from '@/src/config/appIdentity';
import { useDeleteAccount } from '@/src/hooks/mutations/useDeleteAccount';
import { SUPPORTED_LANGUAGES } from '@/src/i18n/constants';
import { useLanguageStore } from '@/src/i18n/languageStore';
import { useAuthStore } from '@/src/store/auth';
import { openExternalUrl } from '@/src/utils/openExternalUrl';

// SETUP: point these at your real hosted legal pages.
const PRIVACY_URL = `https://${appIdentity.associatedDomain}/privacy`;
const TERMS_URL = `https://${appIdentity.associatedDomain}/terms`;

export default function SettingsScreen() {
  const { t } = useTranslation();
  const language = useLanguageStore(s => s.language);
  const setLanguage = useLanguageStore(s => s.setLanguage);
  const signOut = useAuthStore(s => s.signOut);
  const { mutateAsync: deleteAccount, isPending: isDeletingAccount } =
    useDeleteAccount();

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
      contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
    >
      <H1>{t('settings:title')}</H1>

      <View className="mt-6 gap-3">
        <H4>{t('settings:language')}</H4>
        <View className="flex-row flex-wrap gap-2">
          {SUPPORTED_LANGUAGES.map(lang => (
            <AnimatedPressable
              key={lang}
              onPress={() => void setLanguage(lang)}
            >
              <Small
                className={cn(
                  'rounded-full border px-4 py-2',
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

      <View className="mt-8 gap-3">
        <AnimatedPressable onPress={() => void openExternalUrl(PRIVACY_URL)}>
          <Body className="text-primary">{t('settings:privacyPolicy')}</Body>
        </AnimatedPressable>
        <AnimatedPressable onPress={() => void openExternalUrl(TERMS_URL)}>
          <Body className="text-primary">{t('settings:termsOfService')}</Body>
        </AnimatedPressable>
      </View>

      <Button variant="outline" className="mt-8" onPress={() => void signOut()}>
        <Text>{t('settings:signOut')}</Text>
      </Button>

      <AlertDialog>
        <AlertDialogTrigger
          testID="settings-delete-account"
          className="mt-4 items-center justify-center py-2"
        >
          <Body className="text-destructive">
            {t('settings:deleteAccount')}
          </Body>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings:deleteAccountConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings:deleteAccountConfirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>{t('settings:deleteAccountCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="settings-delete-account-confirm"
              className={buttonVariants({ variant: 'destructive' })}
              disabled={isDeletingAccount}
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

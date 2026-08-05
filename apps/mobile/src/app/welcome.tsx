import * as AppleAuthentication from 'expo-apple-authentication';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { Button } from '@/src/components/ui/button';
import { InlineError } from '@/src/components/ui/inline-error';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, Display, Small } from '@/src/components/ui/typography';
import { appIdentity } from '@/src/config/appIdentity';
import { useAuthStore } from '@/src/store/auth';
import { openExternalUrl } from '@/src/utils/openExternalUrl';

const PRIVACY_URL = `https://${appIdentity.associatedDomain}/privacy`;
const TERMS_URL = `https://${appIdentity.associatedDomain}/terms`;

export default function Welcome() {
  const router = useRouter();
  const { t } = useTranslation();
  const signInWithApple = useAuthStore(s => s.signInWithApple);
  const signInWithGoogle = useAuthStore(s => s.signInWithGoogle);
  const error = useAuthStore(s => s.error);
  const isLoading = useAuthStore(s => s.isLoading);

  return (
    <SafeAreaView
      style={{ flex: 1 }}
      className="bg-background"
      testID="welcome-screen"
    >
      <View
        style={{
          flex: 1,
          paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
          paddingBottom: SCREEN_CONTENT_STYLE.padding,
        }}
        className="gap-6"
      >
        <View className="flex-1 justify-center gap-3">
          <Body
            testID="welcome-brand"
            weight="semibold"
            className="text-muted-foreground"
          >
            {appIdentity.name}
          </Body>
          <Display>{t('welcome:title')}</Display>
          <Body className="text-muted-foreground">{t('welcome:subtitle')}</Body>
        </View>

        <View className="shrink-0 gap-3">
          {error ? (
            <InlineError testID="welcome-error" message={error} />
          ) : null}

          {Platform.OS === 'ios' ? (
            <AppleAuthentication.AppleAuthenticationButton
              testID="welcome-sign-in-apple"
              buttonType={
                AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
              }
              buttonStyle={
                AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={14}
              style={{ width: '100%', height: 48 }}
              onPress={() => {
                if (!isLoading) void signInWithApple();
              }}
            />
          ) : (
            <LoadingButton
              testID="welcome-sign-in-apple"
              label={t('auth:signInWithApple')}
              isLoading={isLoading}
              disabled={isLoading}
              onPress={() => void signInWithApple()}
            />
          )}
          <LoadingButton
            testID="welcome-sign-in-google"
            label={t('auth:signInWithGoogle')}
            variant="outline"
            isLoading={isLoading}
            disabled={isLoading}
            onPress={() => void signInWithGoogle()}
          />
          <Button
            testID="welcome-sign-in-email"
            variant="ghost"
            disabled={isLoading}
            onPress={() => router.push('/auth/login' as Href)}
          >
            <Text>{t('auth:signInWithEmail')}</Text>
          </Button>

          <Small testID="welcome-legal" className="text-muted-foreground">
            {t('auth:legalPrefix')}{' '}
            <Text
              className="text-primary"
              onPress={() => void openExternalUrl(TERMS_URL, 'auth-terms')}
            >
              {t('auth:termsOfService')}
            </Text>{' '}
            {t('auth:legalAnd')}{' '}
            <Text
              className="text-primary"
              onPress={() => void openExternalUrl(PRIVACY_URL, 'auth-privacy')}
            >
              {t('auth:privacyPolicy')}
            </Text>
            {t('auth:legalSuffix')}
          </Small>
        </View>
      </View>
    </SafeAreaView>
  );
}

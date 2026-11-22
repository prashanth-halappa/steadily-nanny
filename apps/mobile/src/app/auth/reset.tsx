import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { Button } from '@/src/components/ui/button';
import { InlineError } from '@/src/components/ui/inline-error';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Body, H1 } from '@/src/components/ui/typography';
import { isPasswordTooShort } from '@/src/lib/passwordPolicy';
import { useAuthStore } from '@/src/store/auth';

/**
 * Landing screen for the password-reset email. The link goes to the API, which
 * redirects to `https://<associatedDomain>/auth/reset?token=…` (or `?error=…`
 * when the token is already spent) — a universal link that opens here.
 */
export default function ResetPassword() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const { token, error: linkError } = useLocalSearchParams<{
    token?: string;
    error?: string;
  }>();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const resetPassword = useAuthStore(s => s.resetPassword);
  const clearError = useAuthStore(s => s.clearError);
  const error = useAuthStore(s => s.error);
  const isLoading = useAuthStore(s => s.isLoading);

  const linkUsable = Boolean(token) && !linkError;
  const tooShort = isPasswordTooShort(password);

  const onSubmit = async () => {
    if (!token || tooShort || isLoading) return;
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch {
      // Store already set `error`.
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1 }}
      className="bg-background"
      testID="reset-password-screen"
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            flex: 1,
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
            paddingBottom: SCREEN_CONTENT_STYLE.padding,
          }}
          className="justify-start gap-3"
        >
          <H1>{t('resetPasswordTitle')}</H1>
          {done ? (
            <Body testID="reset-password-success" className="text-primary">
              {t('resetPasswordSuccess')}
            </Body>
          ) : !linkUsable ? (
            <InlineError
              testID="reset-password-link-error"
              message={t('errors.resetLinkInvalid')}
            />
          ) : (
            <>
              <Body className="text-muted-foreground">
                {t('resetPasswordSubtitle')}
              </Body>
              <Input
                testID="reset-password-input"
                accessibilityLabel={t('password')}
                value={password}
                onChangeText={setPassword}
                placeholder={t('password')}
                error={Boolean(error)}
                secureTextEntry
                textContentType="newPassword"
                autoComplete="new-password"
                autoCapitalize="none"
              />
              {error ? (
                <InlineError testID="reset-password-error" message={error} />
              ) : null}
              <Button
                testID="reset-password-submit"
                onPress={() => void onSubmit()}
                disabled={isLoading || tooShort}
              >
                <Text>{t('resetPasswordSubmit')}</Text>
              </Button>
            </>
          )}
          <Button
            variant={done ? 'default' : 'ghost'}
            testID="reset-password-back"
            onPress={() => {
              clearError();
              router.replace('/auth/login' as Href);
            }}
          >
            <Text>{t('backToSignIn')}</Text>
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

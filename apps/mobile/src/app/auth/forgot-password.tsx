import { type Href, useRouter } from 'expo-router';
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
import { useAuthStore } from '@/src/store/auth';

export default function ForgotPassword() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const resetPasswordForEmail = useAuthStore(s => s.resetPasswordForEmail);
  const clearError = useAuthStore(s => s.clearError);
  const error = useAuthStore(s => s.error);
  const isLoading = useAuthStore(s => s.isLoading);

  const onSubmit = async () => {
    if (!email.trim() || isLoading) return;
    try {
      await resetPasswordForEmail(email.trim());
      setSent(true);
    } catch {
      // Store already set `error`.
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1 }}
      className="bg-background"
      testID="forgot-password-screen"
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            flex: 1,
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingBottom: SCREEN_CONTENT_STYLE.padding,
          }}
          className="justify-start gap-3 pt-16"
        >
          <H1>{t('forgotPasswordTitle')}</H1>
          <Body className="text-muted-foreground">
            {t('forgotPasswordSubtitle')}
          </Body>
          {sent ? (
            <Body testID="forgot-password-success" className="text-primary">
              {t('forgotPasswordSuccess')}
            </Body>
          ) : (
            <>
              <Input
                testID="forgot-password-email"
                accessibilityLabel={t('email')}
                value={email}
                onChangeText={setEmail}
                placeholder={t('email')}
                error={Boolean(error)}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              {error ? (
                <InlineError testID="forgot-password-error" message={error} />
              ) : null}
              <Button
                testID="forgot-password-submit"
                onPress={() => void onSubmit()}
                disabled={isLoading || !email.trim()}
              >
                <Text>{t('forgotPasswordSubmit')}</Text>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            testID="forgot-password-back"
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

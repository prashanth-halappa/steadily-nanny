import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/src/components/ui/button';
import { InlineError } from '@/src/components/ui/inline-error';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { appIdentity } from '@/src/config/appIdentity';
import { useAuthStore } from '@/src/store/auth';
import { openExternalUrl } from '@/src/utils/openExternalUrl';

const PRIVACY_URL = `https://${appIdentity.associatedDomain}/privacy`;
const TERMS_URL = `https://${appIdentity.associatedDomain}/terms`;

export default function Register() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const signUp = useAuthStore(s => s.signUp);
  const clearError = useAuthStore(s => s.clearError);
  const error = useAuthStore(s => s.error);
  const isLoading = useAuthStore(s => s.isLoading);

  // A failed sign-in leaves `error` set in the store; without this, arriving
  // here from login's "Create account" renders both fields destructive-red
  // with the stale login message before anything is typed. Same as login.tsx.
  useEffect(() => {
    clearError();
  }, [clearError]);

  return (
    <SafeAreaView
      style={{ flex: 1 }}
      className="bg-background"
      testID="register-screen"
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 justify-center gap-3 px-6">
          <H1>{t('createAccount')}</H1>
          <Input
            testID="register-email"
            accessibilityLabel={t('email')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('email')}
            error={Boolean(error)}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <View className="gap-1">
            <Input
              ref={passwordRef}
              testID="register-password"
              accessibilityLabel={t('password')}
              value={password}
              onChangeText={setPassword}
              placeholder={t('password')}
              error={Boolean(error)}
              secureTextEntry={!passwordVisible}
              textContentType="newPassword"
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={() => void signUp(email, password)}
            />
            <Pressable
              testID="register-password-toggle"
              accessibilityRole="button"
              accessibilityLabel={
                passwordVisible ? t('hidePassword') : t('showPassword')
              }
              onPress={() => setPasswordVisible(v => !v)}
              hitSlop={8}
              className="self-end"
            >
              <Small className="text-primary">
                {passwordVisible ? t('hidePassword') : t('showPassword')}
              </Small>
            </Pressable>
          </View>
          <Body
            testID="register-legal"
            className="text-muted-foreground text-sm"
          >
            {t('legalPrefix')}{' '}
            <Text
              className="text-primary"
              onPress={() => void openExternalUrl(TERMS_URL, 'auth-terms')}
            >
              {t('termsOfService')}
            </Text>{' '}
            {t('legalAnd')}{' '}
            <Text
              className="text-primary"
              onPress={() => void openExternalUrl(PRIVACY_URL, 'auth-privacy')}
            >
              {t('privacyPolicy')}
            </Text>
            {t('legalSuffix')}
          </Body>
          {error ? (
            <InlineError testID="register-error" message={error} />
          ) : null}
          <LoadingButton
            testID="register-submit"
            label={t('createAccountCta')}
            isLoading={isLoading}
            disabled={isLoading}
            onPress={() => void signUp(email, password)}
          />
          <Button variant="ghost" onPress={() => router.back()}>
            <Text>{t('backToSignIn')}</Text>
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

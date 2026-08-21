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
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { Button } from '@/src/components/ui/button';
import { FieldError } from '@/src/components/ui/field-error';
import { InlineError } from '@/src/components/ui/inline-error';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { H1, Small } from '@/src/components/ui/typography';
import { appIdentity } from '@/src/config/appIdentity';
import { isPasswordTooShort } from '@/src/lib/passwordPolicy';
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
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
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

  // Supabase rejects a short password with a 422 the user can't see coming.
  // Catch it here so the only round trip they make is one that can succeed.
  // Held back until the first submit — nobody wants to be told their password
  // is too short while typing its second character.
  const passwordTooShort = isPasswordTooShort(password);
  const showPasswordError = attemptedSubmit && passwordTooShort;

  // `signUp` resolving is NOT the same as being signed in. A project that
  // requires email confirmation returns a successful, session-less sign-up:
  // no error, no auth event, nothing to navigate on. Without this branch the
  // screen just stops — spinner off, no message — and the only feedback the
  // person ever gets is "Confirm your email before signing in." on some later
  // sign-in attempt. Currently the hosted project auto-confirms, so this arm
  // is dormant; it arms itself the moment confirmations are turned on.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const submit = () => {
    setAttemptedSubmit(true);
    if (isPasswordTooShort(password)) return;
    void signUp(email, password).then(outcome => {
      if (outcome === 'confirm-email') setAwaitingConfirmation(true);
    });
  };

  if (awaitingConfirmation) {
    return (
      <SafeAreaView
        style={{ flex: 1 }}
        className="bg-background"
        testID="register-confirm-email"
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
          <H1>{t('confirmEmailTitle')}</H1>
          <Small testID="register-confirm-email-body">
            {t('confirmEmailBody', { email })}
          </Small>
          <Small
            testID="register-confirm-email-hint"
            className="text-muted-foreground"
          >
            {t('confirmEmailHint')}
          </Small>
          <Button
            testID="register-confirm-email-back"
            onPress={() => router.back()}
          >
            <Text>{t('backToSignIn')}</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

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
        <View
          style={{
            flex: 1,
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
            paddingBottom: SCREEN_CONTENT_STYLE.padding,
          }}
          className="justify-start gap-3"
        >
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
              error={Boolean(error) || showPasswordError}
              secureTextEntry={!passwordVisible}
              textContentType="newPassword"
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            {showPasswordError ? (
              <FieldError testID="register-password-error">
                {t('errors.passwordTooShort')}
              </FieldError>
            ) : null}
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
          <Small testID="register-legal" className="text-muted-foreground">
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
          </Small>
          {error ? (
            <InlineError testID="register-error" message={error} />
          ) : null}
          <LoadingButton
            testID="register-submit"
            label={t('createAccountCta')}
            isLoading={isLoading}
            disabled={isLoading}
            onPress={submit}
          />
          <Button variant="ghost" onPress={() => router.back()}>
            <Text>{t('backToSignIn')}</Text>
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

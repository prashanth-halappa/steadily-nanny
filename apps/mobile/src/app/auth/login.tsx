import { type Href, useRouter } from 'expo-router';
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
import { useAuthStore } from '@/src/store/auth';

export default function Login() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const signIn = useAuthStore(s => s.signIn);
  const clearError = useAuthStore(s => s.clearError);
  const error = useAuthStore(s => s.error);
  const isLoading = useAuthStore(s => s.isLoading);

  useEffect(() => {
    clearError();
  }, [clearError]);

  return (
    <SafeAreaView
      style={{ flex: 1 }}
      className="bg-background"
      testID="login-screen"
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 justify-center gap-3 px-6">
          <H1>{t('signIn')}</H1>
          <Input
            testID="login-email"
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
              testID="login-password"
              accessibilityLabel={t('password')}
              value={password}
              onChangeText={setPassword}
              placeholder={t('password')}
              error={Boolean(error)}
              secureTextEntry={!passwordVisible}
              textContentType="password"
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={() => void signIn(email, password)}
            />
            <Pressable
              testID="login-password-toggle"
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
          {error ? <InlineError testID="login-error" message={error} /> : null}
          <Pressable
            testID="login-forgot-password"
            accessibilityRole="button"
            accessibilityLabel={t('forgotPassword')}
            onPress={() => {
              clearError();
              router.push('/auth/forgot-password' as Href);
            }}
            hitSlop={12}
            style={{ minHeight: 44, justifyContent: 'center' }}
            className="self-start"
          >
            <Body className="text-primary">{t('forgotPassword')}</Body>
          </Pressable>
          <LoadingButton
            testID="login-submit"
            label={t('signIn')}
            isLoading={isLoading}
            disabled={isLoading}
            onPress={() => void signIn(email, password)}
          />
          <Button
            variant="ghost"
            onPress={() => router.push('/auth/register' as Href)}
          >
            <Text>{t('createAccount')}</Text>
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { useAuthStore } from '@/src/store/auth';

export default function Login() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signIn = useAuthStore(s => s.signIn);
  const clearError = useAuthStore(s => s.clearError);
  const error = useAuthStore(s => s.error);
  const isLoading = useAuthStore(s => s.isLoading);

  return (
    <SafeAreaView
      style={{ flex: 1 }}
      className="bg-background"
      testID="login-screen"
    >
      <View className="flex-1 justify-center gap-3 px-6">
        <H1>{t('signIn')}</H1>
        <Input
          testID="login-email"
          accessibilityLabel={t('email')}
          value={email}
          onChangeText={setEmail}
          placeholder={t('email')}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Input
          testID="login-password"
          accessibilityLabel={t('password')}
          value={password}
          onChangeText={setPassword}
          placeholder={t('password')}
          secureTextEntry
        />
        {error ? (
          <Small testID="login-error" className="text-destructive">
            {error}
          </Small>
        ) : null}
        <Pressable
          testID="login-forgot-password"
          accessibilityRole="button"
          accessibilityLabel={t('forgotPassword')}
          onPress={() => {
            clearError();
            router.push('/auth/forgot-password' as Href);
          }}
          hitSlop={8}
          className="self-start"
        >
          <Body className="text-primary">{t('forgotPassword')}</Body>
        </Pressable>
        <Button
          testID="login-submit"
          onPress={() => void signIn(email, password)}
          disabled={isLoading}
        >
          <Text>{t('signIn')}</Text>
        </Button>
        <Button
          variant="ghost"
          onPress={() => router.push('/auth/register' as Href)}
        >
          <Text>{t('createAccount')}</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}

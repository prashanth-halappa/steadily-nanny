import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
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
  const signUp = useAuthStore(s => s.signUp);
  const error = useAuthStore(s => s.error);
  const isLoading = useAuthStore(s => s.isLoading);

  return (
    <SafeAreaView
      style={{ flex: 1 }}
      className="bg-background"
      testID="register-screen"
    >
      <View className="flex-1 justify-center gap-3 px-6">
        <H1>{t('createAccount')}</H1>
        <Input
          testID="register-email"
          accessibilityLabel={t('email')}
          value={email}
          onChangeText={setEmail}
          placeholder={t('email')}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <View className="gap-1">
          <Input
            testID="register-password"
            accessibilityLabel={t('password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('password')}
            secureTextEntry={!passwordVisible}
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
        <Body testID="register-legal" className="text-muted-foreground text-sm">
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
          <Small testID="register-error" className="text-destructive">
            {error}
          </Small>
        ) : null}
        <Button
          testID="register-submit"
          onPress={() => void signUp(email, password)}
          disabled={isLoading}
        >
          <Text>{t('createAccountCta')}</Text>
        </Button>
        <Button variant="ghost" onPress={() => router.back()}>
          <Text>{t('backToSignIn')}</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}

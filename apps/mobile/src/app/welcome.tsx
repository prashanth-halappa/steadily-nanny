import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, DisplayLarge } from '@/src/components/ui/typography';
import { useAuthStore } from '@/src/store/auth';

export default function Welcome() {
  const router = useRouter();
  const { t } = useTranslation();
  const signInWithApple = useAuthStore(s => s.signInWithApple);
  const signInWithGoogle = useAuthStore(s => s.signInWithGoogle);

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-background">
      <View className="flex-1 justify-end gap-3 px-6 pb-12">
        <DisplayLarge>{t('welcome:title')}</DisplayLarge>
        <Body className="mb-6 text-muted-foreground">
          {t('welcome:subtitle')}
        </Body>

        <Button onPress={() => void signInWithApple()}>
          <Text>{t('auth:signInWithApple')}</Text>
        </Button>
        <Button variant="outline" onPress={() => void signInWithGoogle()}>
          <Text>{t('auth:signInWithGoogle')}</Text>
        </Button>
        <Button
          variant="ghost"
          onPress={() => router.push('/auth/login' as Href)}
        >
          <Text>{t('auth:signInWithEmail')}</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}

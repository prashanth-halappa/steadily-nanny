import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { H1, Small } from '@/src/components/ui/typography';
import { useAuthStore } from '@/src/store/auth';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signIn = useAuthStore(s => s.signIn);
  const error = useAuthStore(s => s.error);
  const isLoading = useAuthStore(s => s.isLoading);

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-background">
      <View className="flex-1 justify-center gap-3 px-6">
        <H1>Sign in</H1>
        <Input
          accessibilityLabel="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Input
          accessibilityLabel="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
        />
        {error ? <Small className="text-destructive">{error}</Small> : null}
        <Button
          onPress={() => void signIn(email, password)}
          disabled={isLoading}
        >
          <Text>Sign in</Text>
        </Button>
        <Button
          variant="ghost"
          onPress={() => router.push('/auth/register' as Href)}
        >
          <Text>Create an account</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}

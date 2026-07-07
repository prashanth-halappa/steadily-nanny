import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { H1, Small } from '@/src/components/ui/typography';
import { useAuthStore } from '@/src/store/auth';

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signUp = useAuthStore(s => s.signUp);
  const error = useAuthStore(s => s.error);
  const isLoading = useAuthStore(s => s.isLoading);

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-background">
      <View className="flex-1 justify-center gap-3 px-6">
        <H1>Create account</H1>
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
          onPress={() => void signUp(email, password)}
          disabled={isLoading}
        >
          <Text>Sign up</Text>
        </Button>
        <Button variant="ghost" onPress={() => router.back()}>
          <Text>Back to sign in</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}

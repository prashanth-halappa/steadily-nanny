import { Link, Stack } from 'expo-router';
import { View } from 'react-native';
import { Body, H2 } from '@/src/components/ui/typography';

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
        <H2 className="text-center">This screen doesn't exist.</H2>
        <Link href="/">
          <Body className="text-primary">Go home</Body>
        </Link>
      </View>
    </>
  );
}

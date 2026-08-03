import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerBackTitle: '',
      }}
    >
      <Stack.Screen name="login" options={{ title: '' }} />
      <Stack.Screen name="register" options={{ title: '' }} />
      <Stack.Screen name="forgot-password" options={{ title: '' }} />
    </Stack>
  );
}

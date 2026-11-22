// URL polyfill: Hermes' `URL` is incomplete; `new URL()` below needs it.
import 'react-native-url-polyfill/auto';
import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '@/src/api/client';
import { appIdentity } from '@/src/config/appIdentity';

/**
 * Better Auth client. The API mounts Better Auth at `<api origin>/api/auth`,
 * independent of whatever path `EXPO_PUBLIC_API_URL` carries, so only the
 * origin is taken from it (API_URL already has the Android-emulator host swap).
 *
 * The session is a cookie: the expo plugin stores it in SecureStore and replays
 * it on every auth call; `getCookie()` hands it to the axios client for API calls.
 */
export const authClient = createAuthClient({
  baseURL: `${new URL(API_URL ?? '').origin}/api/auth`,
  plugins: [
    expoClient({
      scheme: appIdentity.scheme,
      storagePrefix: appIdentity.scheme,
      storage: SecureStore,
    }),
  ],
});

export type AuthSession = typeof authClient.$Infer.Session;
export type AuthUser = AuthSession['user'];

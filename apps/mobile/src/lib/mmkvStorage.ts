/**
 * MMKV storage for Zustand persistence and Supabase auth.
 * Replaces AsyncStorage and expo-secure-store with react-native-mmkv
 * (synchronous, no size limits).
 */
import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

// Regular storage for app data
export const storage = createMMKV();

// Encrypted storage for auth data (session tokens).
//
// SETUP / SECURITY: `encryptionKey` below is a static constant compiled into the
// JS bundle, so MMKV's at-rest encryption here is effectively obfuscation, not a
// hardware-backed secret — anyone who extracts the bundle can recover the key.
// For stronger protection, derive a per-device key held in the OS
// Keychain/Keystore (e.g. via expo-secure-store) and pass it here; that requires
// a native dependency and an async startup gate. The stored Supabase tokens are
// short-lived and server-revocable, so the static key is an accepted default for
// the template — revisit if you store more sensitive data at rest.
export const secureStorage = createMMKV({
  id: 'secure-storage',
  encryptionKey: 'yourapp-secure-key-v1',
});

// Zustand adapter for regular storage
export const zustandStorage: StateStorage = {
  setItem: (name, value) => storage.set(name, value),
  getItem: name => storage.getString(name) ?? null,
  removeItem: name => storage.remove(name),
};

// Zustand adapter for secure storage (auth)
export const zustandSecureStorage: StateStorage = {
  setItem: (name, value) => secureStorage.set(name, value),
  getItem: name => secureStorage.getString(name) ?? null,
  removeItem: name => secureStorage.remove(name),
};

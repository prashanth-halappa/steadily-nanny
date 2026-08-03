/**
 * Suppress known-benign native LogBox noise that fires before app logic runs.
 *
 * Must be imported in `_layout.tsx` before anything that pulls in
 * `expo-notifications` — that package's `DevicePushTokenAutoRegistration.fx`
 * side-effect reads Keychain at import time and `console.error`s on failure.
 *
 * @module lib/silenceKnownNativeNoise
 */

import { LogBox } from 'react-native';

if (__DEV__) {
  LogBox.ignoreLogs([
    // Unsigned simulator / CODE_SIGNING_ALLOWED=NO builds lack the Keychain
    // entitlement expo-notifications expects. Our registration path already
    // returns null on this failure; only the red LogBox overlay is annoying.
    '[expo-notifications] Error reading persisted server registration info',
  ]);
}

import { useColorScheme as useNativewindColorScheme } from 'nativewind';
import { useEffect } from 'react';

/**
 * ⚠️ DARK MODE IS INTENTIONALLY DISABLED (v1 scope).
 *
 * This hook HARD-FORCES light mode: it always reports `light` /
 * `isDarkColorScheme: false` and no-ops `setColorScheme` / `toggleColorScheme`.
 *
 * A full dark palette IS authored — in `global.css` (`.dark:root`), in
 * `tailwind.config.js`, and in `lib/design-tokens/useThemeColors.ts`
 * (`darkColors`) — but it stays DEAD until you wire up dark mode yourself:
 *   1. Read the system scheme via React Native's `Appearance` API (or expo).
 *   2. Return the real `colorScheme` below and drive NativeWind's `setColorScheme`.
 *   3. Remove the light-forcing effect.
 *
 * Until then, every consumer (Tailwind classes AND `useThemeColors`) resolves to light.
 */
export function useColorScheme() {
  const { colorScheme, setColorScheme } = useNativewindColorScheme();

  useEffect(() => {
    if (colorScheme !== 'light') {
      setColorScheme('light');
    }
  }, [colorScheme, setColorScheme]);

  return {
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: (_scheme: 'light' | 'dark' | 'system' | string) => {},
    toggleColorScheme: () => {},
  };
}

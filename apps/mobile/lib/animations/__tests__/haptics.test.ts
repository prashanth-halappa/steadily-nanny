/**
 * HAPTIC_PATTERNS must never reject when the device cannot vibrate.
 *
 * The named wrappers (`triggerImpactFeedback`, …) already swallow errors;
 * the signature patterns used to call `Haptics.*` raw. A failing haptic
 * must resolve, not throw — otherwise a celebration can crash the screen.
 *
 * @module lib/animations/__tests__/haptics.test
 */
import { describe, expect, it, type mock } from 'bun:test';
import * as Haptics from 'expo-haptics';
import { HAPTIC_PATTERNS } from '@/lib/animations/haptics';

describe('HAPTIC_PATTERNS', () => {
  it.each([
    'achievement',
    'milestone',
    'celebration',
  ] as const)('%s never rejects when impactAsync fails', async name => {
    (Haptics.impactAsync as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.reject(new Error('haptics unavailable'))
    );

    await expect(HAPTIC_PATTERNS[name]()).resolves.toBeUndefined();
  });
});

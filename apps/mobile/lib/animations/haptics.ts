/**
 * Haptics — the single haptics module for the app.
 *
 * Provides three layers:
 *  1. Core wrappers with error handling (triggerImpactFeedback, ...)
 *  2. `hapticFeedback` — named feedback for common UI patterns
 *  3. `HAPTIC_PATTERNS` — expressive, multi-tap patterns for signature moments
 *
 * Cross-platform: iOS (Taptic Engine), Android (Vibrator). Every call is
 * wrapped so an unsupported device silently no-ops instead of throwing.
 *
 * Everything imports from `@/lib/animations/haptics`.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// ─── Core wrappers (error-safe) ──────────────────────────────────────────────

export async function triggerImpactFeedback(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium
): Promise<void> {
  try {
    await Haptics.impactAsync(style);
  } catch {
    // Haptic feedback not supported on this device
  }
}

export async function triggerNotificationFeedback(
  type: Haptics.NotificationFeedbackType
): Promise<void> {
  try {
    await Haptics.notificationAsync(type);
  } catch {
    // Haptic notification not supported on this device
  }
}

export async function triggerSelectionFeedback(): Promise<void> {
  try {
    await Haptics.selectionAsync();
  } catch {
    // Haptic selection feedback not supported on this device
  }
}

// Android-specific haptics for more granular control.
export async function triggerAndroidHaptic(
  type: Haptics.AndroidHaptics
): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Haptics.performAndroidHapticsAsync(type);
    }
  } catch {
    // Android haptic feedback not supported on this device
  }
}

/**
 * Generic convenience trigger — `triggerHaptic('light' | 'medium' | 'heavy')`.
 */
export function triggerHaptic(
  intensity: 'light' | 'medium' | 'heavy' = 'light'
): void {
  const style =
    intensity === 'heavy'
      ? Haptics.ImpactFeedbackStyle.Heavy
      : intensity === 'medium'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
  void triggerImpactFeedback(style);
}

// ─── Named feedback for common UI patterns ───────────────────────────────────

export const hapticFeedback = {
  // Button interactions
  buttonPress: () => triggerImpactFeedback(Haptics.ImpactFeedbackStyle.Light),
  buttonPressHeavy: () =>
    triggerImpactFeedback(Haptics.ImpactFeedbackStyle.Heavy),

  // Navigation
  tabPress: () => triggerSelectionFeedback(),
  modalPresent: () => triggerImpactFeedback(Haptics.ImpactFeedbackStyle.Medium),

  // States
  success: () =>
    triggerNotificationFeedback(Haptics.NotificationFeedbackType.Success),
  error: () =>
    triggerNotificationFeedback(Haptics.NotificationFeedbackType.Error),
  warning: () =>
    triggerNotificationFeedback(Haptics.NotificationFeedbackType.Warning),

  // Android-specific patterns (gracefully ignored on other platforms)
  androidKeyboardPress: () =>
    triggerAndroidHaptic(Haptics.AndroidHaptics.Keyboard_Press),
  androidToggleOn: () => triggerAndroidHaptic(Haptics.AndroidHaptics.Toggle_On),
  androidToggleOff: () =>
    triggerAndroidHaptic(Haptics.AndroidHaptics.Toggle_Off),
  androidLongPress: () =>
    triggerAndroidHaptic(Haptics.AndroidHaptics.Long_Press),
} as const;

// ─── Expressive multi-tap patterns for signature moments ─────────────────────

export const HAPTIC_PATTERNS = {
  // Standard feedback
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),

  // Contextual patterns for signature animations
  explore: () => {
    // Gentle tap for exploration
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },

  achievement: async () => {
    // Success pattern: medium → light → light
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 100);
    setTimeout(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 200);
  },

  milestone: async () => {
    // Crescendo pattern: light → medium → heavy
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, 150);
    setTimeout(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }, 300);
  },

  celebration: async () => {
    // Double tap for celebration
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 100);
  },

  encouragement: () => {
    // Gentle, warm tap
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },

  selection: () => Haptics.selectionAsync(),
} as const;

// Default export for convenience.
export default HAPTIC_PATTERNS;

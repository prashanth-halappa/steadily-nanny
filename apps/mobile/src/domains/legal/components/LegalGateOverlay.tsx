/**
 * @module domains/legal/components/LegalGateOverlay
 * Full-screen fail-closed overlay rendered as a sibling above `<Stack>` so the
 * navigator never unmounts during transient loading (GOLDEN-FIXES #18). Uses a
 * plain React Native `View` (never Reanimated `Animated.View` with `className`,
 * GOLDEN-FIXES #2).
 */
import { StyleSheet, View } from 'react-native';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { useLegalGate } from '@/src/hooks/useLegalGate';

export function LegalGateOverlay() {
  const { state, retry } = useLegalGate();

  if (state === 'accepted') {
    return null;
  }

  if (state === 'error') {
    return (
      <View
        testID="legal-gate-error"
        style={StyleSheet.absoluteFill}
        className="bg-background"
      >
        <ErrorState variant="network" onRetry={retry} />
      </View>
    );
  }

  return (
    <View
      testID="legal-gate-loading"
      style={StyleSheet.absoluteFill}
      className="items-center justify-center bg-background"
    >
      <LoadingIndicator />
    </View>
  );
}

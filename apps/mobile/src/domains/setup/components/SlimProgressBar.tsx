import { View } from 'react-native';

/** Thin setup-flow progress bar. `ratio` is 0..1. */
export function SlimProgressBar({ ratio }: { ratio: number }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <View
      testID="slim-progress-bar"
      className="h-1 w-full overflow-hidden rounded-full bg-muted"
    >
      {/* Plain View (not Animated) — className width is fine here. */}
      <View
        className="h-full rounded-full bg-primary"
        style={{ width: `${pct}%` }}
      />
    </View>
  );
}

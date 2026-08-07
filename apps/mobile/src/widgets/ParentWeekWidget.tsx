/**
 * @module widgets/ParentWeekWidget
 *
 * P2 — the parent's "this week" home-screen widget. `systemSmall`,
 * `systemMedium` only (no accessory family — see `app.config.js`). Hours +
 * neutral status text. No pill, no nag, never money (Priya's condition).
 *
 * See `NextShiftWidget.tsx`'s header for why this is one self-contained
 * `'widget'`-directive function with no repo imports beyond erased `import
 * type`.
 */
import { Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  monospacedDigit,
  padding,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import type { WidgetEnvironment } from 'expo-widgets';

import { createWidgetSafe } from '@/src/lib/expoWidgets';

import { registerWidgetTargets } from '@/src/lib/widgetSnapshot';
import type { ParentWeekWidgetProps } from '@/src/lib/widgetSnapshot.types';

function ParentWeekWidgetView(
  props: ParentWeekWidgetProps,
  env: WidgetEnvironment
) {
  'widget';
  const dark = env.colorScheme === 'dark';
  const FG = dark ? '#F1EAF0' : '#2A1F2B';
  const MUTED = dark ? '#B2A4B3' : '#6E6270';

  // No snapshot has ever reached this widget: never signed in, or a NANNY
  // added it — nobody feeds the other persona's widgets (see
  // `useWidgetSnapshotSync`'s header), so every prop is `undefined`. English
  // literal on purpose: the localized copy travels IN the snapshot, and there
  // isn't one.
  if (!props.hours) {
    return (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[padding({ all: 14 })]}
      >
        <Text
          modifiers={[
            font({ size: 11, weight: 'semibold' }),
            foregroundStyle(MUTED),
          ]}
        >
          Steadily
        </Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
          Open Steadily to get started
        </Text>
      </VStack>
    );
  }

  return (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[padding({ all: 14 }), widgetURL(props.deepLink)]}
    >
      <Text
        modifiers={[
          font({ size: 11, weight: 'semibold' }),
          foregroundStyle(MUTED),
        ]}
      >
        {props.title}
      </Text>
      <Text
        modifiers={[
          font({ size: 30, weight: 'semibold' }),
          foregroundStyle(FG),
          monospacedDigit(),
        ]}
      >
        {props.hours}
      </Text>
      {props.scheduledLine ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
          {props.scheduledLine}
        </Text>
      ) : null}
      <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
        {props.statusLabel}
      </Text>
    </VStack>
  );
}

export const ParentWeekWidget = createWidgetSafe(
  'ParentWeek',
  ParentWeekWidgetView
);

registerWidgetTargets({ parentWeek: ParentWeekWidget });

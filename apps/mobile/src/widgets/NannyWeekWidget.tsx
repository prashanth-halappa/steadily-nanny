/**
 * @module widgets/NannyWeekWidget
 *
 * N3 — the nanny's "this week" home-screen widget. `systemSmall`,
 * `systemMedium`, `accessoryRectangular`. Hours + a status pill + the
 * submitted→approved delta when the week was adjusted on approval.
 *
 * See `NextShiftWidget.tsx`'s header for why this is one self-contained
 * `'widget'`-directive function with no repo imports beyond erased `import
 * type`. Palette hexes are inlined for the same reason (see
 * `OnTheClock.tsx`'s header) — `__tests__/NannyWeekWidget.palette.test.ts`
 * pins them against `palette.ts`.
 *
 * `props.tone` (`WeekStatusTone`) drives the pill's color — computed
 * upstream in `buildNannyWeekPayload` from `timesheet.status`, never derived
 * here from the pre-localized `statusLabel` text (which would break in
 * `es`).
 */
import { Text, VStack } from '@expo/ui/swift-ui';
import {
  background,
  cornerRadius,
  font,
  foregroundStyle,
  monospacedDigit,
  padding,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import type { WidgetEnvironment } from 'expo-widgets';

import { createWidgetSafe } from '@/src/lib/expoWidgets';

import { registerWidgetTargets } from '@/src/lib/widgetSnapshot';
import type { NannyWeekWidgetProps } from '@/src/lib/widgetSnapshot.types';

function NannyWeekWidgetView(
  props: NannyWeekWidgetProps,
  env: WidgetEnvironment
) {
  'widget';
  const dark = env.colorScheme === 'dark';
  const FG = dark ? '#F1EAF0' : '#2A1F2B';
  const MUTED = dark ? '#B2A4B3' : '#6E6270';
  const OCHRE = dark ? '#E0B061' : '#C08A3E';
  const GREEN = dark ? '#6FB98A' : '#4A7A5C';
  const TERRACOTTA = dark ? '#E89A63' : '#C4693A';

  const family = env.widgetFamily;
  const isAccessory = family === 'accessoryRectangular';

  // No snapshot has ever reached this widget: never signed in, or a PARENT
  // added it — nobody feeds the other persona's widgets (see
  // `useWidgetSnapshotSync`'s header), so every prop is `undefined` and this
  // rendered as a blank white card. English literal on purpose: the localized
  // copy travels IN the snapshot, and there isn't one.
  if (!props.hours) {
    const fallback = (
      <VStack alignment="leading" spacing={4}>
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
    return isAccessory ? (
      fallback
    ) : (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[padding({ all: 14 })]}
      >
        {fallback}
      </VStack>
    );
  }

  const pillFg =
    props.tone === 'ochre'
      ? OCHRE
      : props.tone === 'green'
        ? GREEN
        : props.tone === 'terracotta'
          ? TERRACOTTA
          : MUTED;
  // 20% alpha tint of the same color — `@expo/ui`'s Color hex format is
  // AARRGGBB (alpha first), so the tint is a prefix, not a suffix.
  const pillBg = `#33${pillFg.slice(1)}`;

  const pill = (
    <Text
      modifiers={[
        font({ size: 12, weight: 'semibold' }),
        foregroundStyle(pillFg),
        padding({ horizontal: 8, vertical: 3 }),
        background(pillBg),
        cornerRadius(8),
      ]}
    >
      {props.statusLabel}
    </Text>
  );

  if (isAccessory) {
    return (
      <VStack
        alignment="leading"
        spacing={1}
        modifiers={[widgetURL(props.deepLink)]}
      >
        <Text
          modifiers={[
            font({ size: 15, weight: 'semibold' }),
            monospacedDigit(),
          ]}
        >
          {props.hours}
        </Text>
        <Text modifiers={[font({ size: 11 })]}>{props.statusLabel}</Text>
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
      {pill}
      {props.adjustmentNote ? (
        <Text
          modifiers={[
            font({ size: 12 }),
            foregroundStyle(MUTED),
            monospacedDigit(),
          ]}
        >
          {props.adjustmentNote}
        </Text>
      ) : null}
    </VStack>
  );
}

export const NannyWeekWidget = createWidgetSafe(
  'NannyWeek',
  NannyWeekWidgetView
);

registerWidgetTargets({ nannyWeek: NannyWeekWidget });

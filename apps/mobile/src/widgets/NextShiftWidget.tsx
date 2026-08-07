/**
 * @module widgets/NextShiftWidget
 *
 * N2 — the nanny's "next shift" home-screen widget. `systemSmall`,
 * `systemMedium`, `accessoryRectangular`, `accessoryInline`.
 *
 * ── Everything below is a single `'widget'`-directive function ──────────
 * Babel serializes `NextShiftWidgetView` to a source STRING, evaluated in a
 * bare JavaScriptCore context inside the widget extension. That context has
 * only the `@expo/ui/swift-ui` globals — no repo imports beyond `import
 * type` (erased before serialization), no sibling helper functions. See
 * `OnTheClock.tsx`'s header for the full explanation. The freshness/family
 * logic here is deliberately duplicated from `widgets/lib/render.ts`, which
 * exists only so that logic can be unit-tested — the components themselves
 * cannot render outside WidgetKit, so they are not tested directly.
 */
import { HStack, Text, VStack } from '@expo/ui/swift-ui';
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
import type { ReactElement } from 'react';
import { createWidgetSafe } from '@/src/lib/expoWidgets';
import { registerWidgetTargets } from '@/src/lib/widgetSnapshot';
import type { NextShiftWidgetProps } from '@/src/lib/widgetSnapshot.types';

function NextShiftWidgetView(
  props: NextShiftWidgetProps,
  env: WidgetEnvironment
) {
  'widget';
  // Daylight palette (lib/design-tokens/palette.ts), inlined — see this
  // module's header for why. Both modes: widgets follow system appearance.
  const dark = env.colorScheme === 'dark';
  const FG = dark ? '#F1EAF0' : '#2A1F2B';
  const MUTED = dark ? '#B2A4B3' : '#6E6270';
  const CARD = dark ? '#241C26' : '#FFFFFF';
  const OCHRE = dark ? '#E0B061' : '#C08A3E';
  const OCHRE_FG = dark ? '#1B151C' : '#2A1F2B';

  const family = env.widgetFamily;
  const isAccessory =
    family === 'accessoryRectangular' || family === 'accessoryInline';
  const isMedium = family === 'systemMedium';

  // No snapshot has ever reached this widget: never signed in, or a PARENT
  // added it — nobody feeds the other persona's widgets (see
  // `useWidgetSnapshotSync`'s header), so `props.state` is `undefined` and
  // every read below it would throw. English literal on purpose: the
  // localized copy travels IN the snapshot, and there isn't one.
  if (!props.state) {
    if (family === 'accessoryInline') return <Text>Open Steadily</Text>;
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
        <Text modifiers={[font({ size: 15 }), foregroundStyle(MUTED)]}>
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
        modifiers={[padding({ all: 14 }), background(CARD)]}
      >
        {fallback}
      </VStack>
    );
  }

  // Duplicated from `showChildrenLine` (widgets/lib/render.ts): never on
  // accessory families; on systemSmall only when no pending banner competes.
  // Truthiness, never `=== null`: `widgetSafeProps` strips null props on the
  // way in, so an absent banner arrives here as `undefined`.
  const showChildren = isAccessory ? false : isMedium ? true : !props.pending;

  const label = (text: string) => (
    <Text
      modifiers={[
        font({ size: 11, weight: 'semibold' }),
        foregroundStyle(MUTED),
      ]}
    >
      {text}
    </Text>
  );

  const pendingBanner = props.pending ? (
    <VStack
      alignment="leading"
      spacing={2}
      modifiers={[padding({ all: 8 }), background(OCHRE), cornerRadius(10)]}
    >
      <Text
        modifiers={[
          font({ size: 12, weight: 'semibold' }),
          foregroundStyle(OCHRE_FG),
        ]}
      >
        {props.pending.label}
      </Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(OCHRE_FG)]}>
        {props.pending.detail}
      </Text>
    </VStack>
  ) : null;

  let body: ReactElement;
  const state = props.state;

  if (state.kind === 'neverSynced' || state.kind === 'empty') {
    body = (
      <VStack alignment="leading" spacing={4}>
        {label(state.title)}
        <Text modifiers={[font({ size: 15 }), foregroundStyle(MUTED)]}>
          {state.body}
        </Text>
      </VStack>
    );
  } else if (state.kind === 'onClock') {
    body = (
      <VStack alignment="leading" spacing={4}>
        {label(state.title)}
        <Text
          modifiers={[
            font({ size: 15, weight: 'semibold' }),
            foregroundStyle(FG),
            monospacedDigit(),
          ]}
        >
          {state.detail}
        </Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
          {state.householdName}
        </Text>
      </VStack>
    );
  } else if (state.kind === 'startingSoon') {
    body = (
      <VStack alignment="leading" spacing={4}>
        {label(state.title)}
        <Text
          modifiers={[
            font({ size: 22, weight: 'semibold' }),
            foregroundStyle(FG),
            monospacedDigit(),
          ]}
        >
          {state.time}
        </Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
          {state.householdName}
        </Text>
        {showChildren && state.childrenLine ? (
          <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
            {state.childrenLine}
          </Text>
        ) : null}
      </VStack>
    );
  } else if (state.kind === 'shiftStarted') {
    body = (
      <VStack alignment="leading" spacing={4}>
        <Text
          modifiers={[
            font({ size: 15, weight: 'semibold' }),
            foregroundStyle(OCHRE),
          ]}
        >
          {state.title}
        </Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(OCHRE)]}>
          {state.body}
        </Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
          {state.householdName}
        </Text>
      </VStack>
    );
  } else {
    // 'nextShift' — systemSmall gets rows[0] only, systemMedium gets both.
    const rows = isMedium ? state.rows : state.rows.slice(0, 1);
    body = (
      <VStack alignment="leading" spacing={10}>
        {label(state.title)}
        {rows.map(row => (
          <VStack
            key={`${row.dayLabel}-${row.timeRange}`}
            alignment="leading"
            spacing={2}
          >
            <HStack spacing={6}>
              <Text
                modifiers={[
                  font({ size: 13, weight: 'semibold' }),
                  foregroundStyle(FG),
                ]}
              >
                {row.dayLabel}
              </Text>
              <Text
                modifiers={[
                  font({ size: 15, weight: 'semibold' }),
                  foregroundStyle(FG),
                  monospacedDigit(),
                ]}
              >
                {row.timeRange}
              </Text>
            </HStack>
            <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
              {row.householdName}
            </Text>
            {showChildren && row.childrenLine ? (
              <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
                {row.childrenLine}
              </Text>
            ) : null}
          </VStack>
        ))}
      </VStack>
    );
  }

  if (isAccessory) {
    // Lock screen: plain, minimal — the system applies vibrant rendering.
    // accessoryRectangular gets up to 3 short lines; accessoryInline gets one.
    const line1 =
      state.kind === 'nextShift'
        ? (state.rows[0]?.timeRange ?? state.title)
        : state.kind === 'startingSoon'
          ? state.time
          : state.kind === 'onClock'
            ? state.detail
            : state.kind === 'shiftStarted'
              ? state.title
              : state.title;
    const line2 =
      state.kind === 'nextShift'
        ? state.rows[0]?.householdName
        : state.kind === 'startingSoon' || state.kind === 'shiftStarted'
          ? state.householdName
          : state.kind === 'onClock'
            ? state.householdName
            : undefined;

    if (family === 'accessoryInline') {
      return (
        <Text modifiers={[widgetURL(props.deepLink)]}>
          {line2 ? `${line1} · ${line2}` : line1}
        </Text>
      );
    }
    return (
      <VStack
        alignment="leading"
        spacing={1}
        modifiers={[widgetURL(props.deepLink)]}
      >
        <Text
          modifiers={[
            font({ size: 12, weight: 'semibold' }),
            monospacedDigit(),
          ]}
        >
          {line1}
        </Text>
        {line2 ? <Text modifiers={[font({ size: 11 })]}>{line2}</Text> : null}
      </VStack>
    );
  }

  return (
    <VStack
      alignment="leading"
      spacing={10}
      modifiers={[
        padding({ all: 14 }),
        background(CARD),
        widgetURL(props.deepLink),
      ]}
    >
      {pendingBanner}
      {body}
    </VStack>
  );
}

export const NextShiftWidget = createWidgetSafe(
  'NextShift',
  NextShiftWidgetView
);

registerWidgetTargets({ nextShift: NextShiftWidget });

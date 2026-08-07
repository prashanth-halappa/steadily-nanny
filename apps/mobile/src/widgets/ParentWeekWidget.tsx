/**
 * @module widgets/ParentWeekWidget
 *
 * P2 — the parent's "this week" home-screen widget. `systemSmall`,
 * `systemMedium` only (no accessory family — see `app.config.js`).
 *
 * NannyWeek's skeleton minus two things, both policy: **no pill ever**
 * (approval status is the nanny's concern, not a parent's nag) and never
 * money, never overdue. Status is neutral `MUTED` text in every state.
 *
 * See `NextShiftWidget.tsx`'s header for why this is one self-contained
 * `'widget'`-directive function with no repo imports beyond erased `import
 * type`.
 */
import { HStack, Image, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  offset,
  padding,
  resizable,
  widgetAccentedRenderingMode,
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
  const CARD = dark ? '#241C26' : '#FFFFFF';
  const PLUM = dark ? '#C9A2CB' : '#5B3E5D';

  const isMedium = env.widgetFamily === 'systemMedium';

  const mark = (
    <Image
      systemName="checkmark"
      size={11}
      modifiers={[
        foregroundStyle(`${PLUM}59`),
        widgetAccentedRenderingMode('accented'),
        accessibilityHidden(true),
      ]}
    />
  );

  // No snapshot has ever reached this widget: never signed in, or a NANNY
  // added it — nobody feeds the other persona's widgets (see
  // `useWidgetSnapshotSync`'s header), so every prop is `undefined`. English literal unless the snapshot
  // is a wrong-persona REDIRECT, which carries pre-localized
  // `fallbackTitle`/`fallbackBody` — the only localized copy that reaches
  // this branch, since the widget has no i18n runtime.
  if (!props.hours) {
    // `systemSmall` only, and the copy reserves a gutter: `offset` does not
    // affect layout, so without one the text sets across the illustration.
    const fallbackArt = isMedium
      ? null
      : dark
        ? props.artDarkUri
        : props.artLightUri;
    return (
      <ZStack modifiers={[containerBackground(CARD, 'widget')]}>
        {fallbackArt ? (
          <ZStack
            modifiers={[
              frame({
                maxWidth: 10000,
                maxHeight: 10000,
                alignment: 'bottomTrailing',
              }),
            ]}
          >
            <Image
              uiImage={fallbackArt}
              modifiers={[
                resizable(),
                frame({ width: 72, height: 72 }),
                offset({ x: 14, y: 10 }),
                widgetAccentedRenderingMode('accentedDesaturated'),
                accessibilityHidden(true),
              ]}
            />
          </ZStack>
        ) : null}
        <VStack
          alignment="leading"
          spacing={4}
          modifiers={[
            padding({ trailing: fallbackArt ? 48 : 0 }),
            frame({
              maxWidth: 10000,
              maxHeight: 10000,
              alignment: 'topLeading',
            }),
          ]}
        >
          <Text
            modifiers={[
              font({ size: 11, weight: 'semibold' }),
              foregroundStyle(MUTED),
              lineLimit(1),
            ]}
          >
            {props.fallbackTitle ? props.fallbackTitle : 'Steadily'}
          </Text>
          <Text
            modifiers={[
              font({ size: 13 }),
              foregroundStyle(MUTED),
              lineLimit(6),
              minimumScaleFactor(0.8),
            ]}
          >
            {props.fallbackBody
              ? props.fallbackBody
              : 'Open Steadily to get started'}
          </Text>
        </VStack>
      </ZStack>
    );
  }

  const kicker = (
    <HStack alignment="center" spacing={6}>
      <Text
        modifiers={[
          font({ size: 11, weight: 'semibold' }),
          foregroundStyle(MUTED),
          lineLimit(1),
          // The kicker shares its row with a glyph and the identity mark, so
          // it has ~110pt on a 158pt card — enough to truncate
          // "Needs your response" to `Needs your re…`. It scales instead.
          minimumScaleFactor(0.75),
        ]}
      >
        {props.title}
      </Text>
      <Spacer />
      {mark}
    </HStack>
  );

  const hero = (
    <Text
      modifiers={[
        font({
          size: isMedium ? 34 : 32,
          weight: 'semibold',
          design: 'rounded',
        }),
        foregroundStyle(FG),
        monospacedDigit(),
        lineLimit(1),
        minimumScaleFactor(0.6),
      ]}
    >
      {props.hours}
    </Text>
  );

  const scheduled = props.scheduledLine ? (
    <Text
      modifiers={[
        font({ size: 12 }),
        foregroundStyle(MUTED),
        monospacedDigit(),
        lineLimit(1),
        minimumScaleFactor(0.8),
      ]}
    >
      {props.scheduledLine}
    </Text>
  ) : null;

  const spokenLabel = `${props.title}. ${props.hours}. ${
    props.scheduledLine ?? ''
  } ${props.statusLabel}`;

  if (isMedium) {
    return (
      <HStack
        alignment="top"
        spacing={16}
        modifiers={[
          containerBackground(CARD, 'widget'),
          widgetURL(props.deepLink),
          accessibilityElement('combine'),
          accessibilityLabel(spokenLabel),
        ]}
      >
        <VStack
          alignment="leading"
          spacing={0}
          modifiers={[
            frame({
              maxWidth: 10000,
              maxHeight: 10000,
              alignment: 'topLeading',
            }),
          ]}
        >
          {kicker}
          <Spacer />
          {hero}
          {scheduled}
        </VStack>
        {/* "Sent Friday · awaiting approval · today" finally sets as a block
            instead of a squeezed single line. */}
        <VStack
          alignment="leading"
          spacing={0}
          modifiers={[
            frame({
              maxWidth: 150,
              maxHeight: 10000,
              alignment: 'bottomLeading',
            }),
          ]}
        >
          <Spacer />
          <Text
            modifiers={[
              font({ size: 13 }),
              foregroundStyle(MUTED),
              lineLimit(3),
            ]}
          >
            {props.statusLabel}
          </Text>
        </VStack>
      </HStack>
    );
  }

  return (
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[
        containerBackground(CARD, 'widget'),
        widgetURL(props.deepLink),
        frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' }),
        accessibilityElement('combine'),
        accessibilityLabel(spokenLabel),
      ]}
    >
      {kicker}
      <Spacer />
      {hero}
      {scheduled}
      {/* Two lines, not one: "Sent Friday · awaiting approval · today" is 38
          characters, and 12pt × 0.85 = 10.2pt still truncated it to
          `Sent Friday · await…` on a 158pt card. Wrapping is the only way this
          string survives at a legible size, and it is the last element on the
          card, so there is room below it. */}
      <Text
        modifiers={[
          font({ size: 12 }),
          foregroundStyle(MUTED),
          lineLimit(2),
          minimumScaleFactor(0.85),
        ]}
      >
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

/**
 * @module widgets/NannyWeekWidget
 *
 * N3 — the nanny's "this week" home-screen widget. `systemSmall`,
 * `systemMedium`, `accessoryRectangular`. Hours as the hero, a status line
 * below it, and on `systemMedium` the paper trail (status + the
 * submitted→approved delta) in a second column.
 *
 * See `NextShiftWidget.tsx`'s header for why this is one self-contained
 * `'widget'`-directive function with no repo imports beyond erased `import
 * type`. Palette hexes are inlined for the same reason (see
 * `OnTheClock.tsx`'s header) — `__tests__/NannyWeekWidget.palette.test.ts`
 * pins them against `palette.ts`.
 *
 * `props.tone` (`WeekStatusTone`) drives the status colour — computed
 * upstream in `buildNannyWeekPayload` from `timesheet.status`, never derived
 * here from the pre-localized `statusLabel` text (which would break in
 * `es`).
 */
import {
  AccessoryWidgetBackground,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  background,
  containerBackground,
  cornerRadius,
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
import type { NannyWeekWidgetProps } from '@/src/lib/widgetSnapshot.types';

function NannyWeekWidgetView(
  props: NannyWeekWidgetProps,
  env: WidgetEnvironment
) {
  'widget';
  const dark = env.colorScheme === 'dark';
  const FG = dark ? '#F1EAF0' : '#2A1F2B';
  const MUTED = dark ? '#B2A4B3' : '#6E6270';
  const CARD = dark ? '#241C26' : '#FFFFFF';
  const PLUM = dark ? '#C9A2CB' : '#5B3E5D';
  const OCHRE = dark ? '#E0B061' : '#C08A3E';
  const GREEN = dark ? '#6FB98A' : '#4A7A5C';
  const TERRACOTTA = dark ? '#E89A63' : '#C4693A';

  const family = env.widgetFamily;
  const isAccessory = family === 'accessoryRectangular';
  const isMedium = family === 'systemMedium';

  // Four Steadily widgets can share a home screen and the OS labels exactly
  // one of them. `primary` at 35% — present, never competing with the hero.
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

  // No snapshot has ever reached this widget: never signed in, or a PARENT
  // added it — nobody feeds the other persona's widgets (see
  // `useWidgetSnapshotSync`'s header), so every prop is `undefined` and this
  // rendered as a blank white card. English literal on purpose: the localized
  // copy travels IN the snapshot, and there isn't one.
  if (!props.hours) {
    // `systemSmall` only, and the copy reserves a gutter: `offset` does not
    // affect layout, so without one the text sets across the illustration.
    const fallbackArt = isMedium
      ? null
      : dark
        ? props.artDarkUri
        : props.artLightUri;
    const fallback = (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[padding({ trailing: fallbackArt ? 48 : 0 })]}
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
    if (isAccessory) return fallback;
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
            frame({
              maxWidth: 10000,
              maxHeight: 10000,
              alignment: 'topLeading',
            }),
          ]}
        >
          {fallback}
        </VStack>
      </ZStack>
    );
  }

  const statusFg =
    props.tone === 'ochre'
      ? OCHRE
      : props.tone === 'green'
        ? GREEN
        : props.tone === 'terracotta'
          ? TERRACOTTA
          : MUTED;

  // `@expo/ui` hex strings are #RRGGBBAA — alpha LAST. `expo-modules-core`'s
  // `Convertibles+Color.swift` pads a 6-digit string to 8 with `FF` and reads
  // `red = rgba >> 24`; the alpha-first path exists only for numeric colors.
  // This was `'#33' + fg.slice(1)`, which turned ochre `#C08A3E` into
  // `#33C08A3E` — mint green at 24% behind amber text.
  const pillBg = `${statusFg}29`;

  // Pills only for terminal states. Pending/not-submitted renders as plain
  // coloured text: a chip cannot scale, and `Sent Friday…` truncated at 158pt.
  const status =
    props.tone === 'green' || props.tone === 'terracotta' ? (
      <Text
        modifiers={[
          font({ size: 12, weight: 'semibold' }),
          foregroundStyle(statusFg),
          padding({ horizontal: 8, vertical: 3 }),
          background(pillBg),
          cornerRadius(8),
          lineLimit(1),
          minimumScaleFactor(0.85),
        ]}
      >
        {props.statusLabel}
      </Text>
    ) : (
      // Two lines, not one: "Sent Friday · awaiting approval · today" is 38
      // characters, and 12pt × 0.85 = 10.2pt still truncated it to
      // `Sent Friday · await…` on a 158pt card. Wrapping is the only way this
      // string survives at a legible size — and killing that ellipsis is the
      // whole point of dropping the chip for these two tones.
      <Text
        modifiers={[
          font({ size: 12, weight: 'semibold' }),
          foregroundStyle(statusFg),
          lineLimit(2),
          minimumScaleFactor(0.85),
        ]}
      >
        {props.statusLabel}
      </Text>
    );

  if (isAccessory) {
    return (
      <ZStack modifiers={[widgetURL(props.deepLink)]}>
        <AccessoryWidgetBackground />
        <VStack
          alignment="leading"
          spacing={1}
          modifiers={[
            frame({
              maxWidth: 10000,
              maxHeight: 10000,
              alignment: 'leading',
            }),
          ]}
        >
          <Text
            modifiers={[
              font({ size: 15, weight: 'semibold' }),
              monospacedDigit(),
              lineLimit(1),
              minimumScaleFactor(0.7),
            ]}
          >
            {props.hours}
          </Text>
          <Text modifiers={[font({ size: 11 }), lineLimit(1)]}>
            {props.statusLabel}
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

  // 32pt degrading to ~19pt before it clips: `11h 29m` cannot truncate at any
  // width this widget sees, which `11h 2…` on a 158pt card is what this fixes.
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
          accessibilityLabel(
            props.adjustmentNote
              ? `${spokenLabel}. ${props.adjustmentNote}`
              : spokenLabel
          ),
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
        {/* The trust question: has anyone signed off, and did the number move. */}
        <VStack
          alignment="leading"
          spacing={6}
          modifiers={[
            frame({
              maxWidth: 150,
              maxHeight: 10000,
              alignment: 'bottomLeading',
            }),
          ]}
        >
          <Spacer />
          {status}
          {props.adjustmentNote ? (
            <Text
              modifiers={[
                font({ size: 12 }),
                foregroundStyle(MUTED),
                monospacedDigit(),
                lineLimit(2),
              ]}
            >
              {props.adjustmentNote}
            </Text>
          ) : null}
        </VStack>
      </HStack>
    );
  }

  // systemSmall: `adjustmentNote` is dropped — five text objects do not fit
  // 158pt, and the delta is an audit detail, not a glance datum.
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
      {status}
    </VStack>
  );
}

export const NannyWeekWidget = createWidgetSafe(
  'NannyWeek',
  NannyWeekWidgetView
);

registerWidgetTargets({ nannyWeek: NannyWeekWidget });

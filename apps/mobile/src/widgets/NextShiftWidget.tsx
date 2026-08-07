/**
 * @module widgets/NextShiftWidget
 *
 * N2 — the nanny's "next shift" home-screen widget. `systemSmall`,
 * `systemMedium`, `accessoryRectangular`, `accessoryInline`.
 *
 * Kicker at the top, `Spacer`, hero at the bottom — the shape that removes
 * the dead lower half every earlier revision of this card had. Exactly one
 * state flips the whole card: `pending`, which becomes a solid `warning`
 * ground with `warningForeground` ink (5.23:1 light / 9.13:1 dark). `MUTED`
 * is 3.10:1 on amber and must never appear there, so secondary lines on the
 * flipped card shed SIZE, not colour.
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
import {
  AccessoryWidgetBackground,
  Circle,
  HStack,
  Image,
  Rectangle,
  Spacer,
  Text,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
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
  // `liveCardBackground()` from lib/design-tokens/elevation.ts — highlight
  // mixed onto card at 8%, opaque. Pinned in this widget's palette test.
  const CARD_LIVE = dark ? '#342629' : '#FDF5EF';
  const PLUM = dark ? '#C9A2CB' : '#5B3E5D';
  const APRICOT = dark ? '#F2954B' : '#E8823C';
  const OCHRE = dark ? '#E0B061' : '#C08A3E';
  const OCHRE_FG = dark ? '#1B151C' : '#2A1F2B';

  // NO manual padding on any surface that carries `containerBackground(…,
  // 'widget')`: that modifier opts the widget INTO WidgetKit's default content
  // margins (~20pt on a 6.9" device), and a `padding({ all: 16 })` on top of
  // them measured ~36pt of inset per side on device — 86pt of usable width on
  // a 158pt card, which is what was truncating the status line. The system
  // margin IS the padding; the accessory families get none because they carry
  // no container background.

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
        <Text modifiers={[font({ size: 15 }), foregroundStyle(MUTED)]}>
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

  const state = props.state;
  // Truthiness, never `=== null`: `widgetSafeProps` strips null props on the
  // way in, so an absent banner arrives here as `undefined`.
  const pending = props.pending ? props.pending : null;
  const isLive = state.kind === 'onClock';

  // The pending flip owns every colour on the card; `MUTED` on amber fails
  // contrast, so on a flipped card secondary text is WARN_INK at a smaller
  // size rather than a second colour.
  const INK = pending ? OCHRE_FG : FG;
  const SUB = pending ? OCHRE_FG : MUTED;
  const ACCENT = pending ? OCHRE_FG : PLUM;

  // `childrenLine` drops first under pressure: never on accessory, and never
  // on a flipped card, where the response request outranks who is being
  // looked after.
  const showChildren = !isAccessory && !pending;

  const rows = state.kind === 'nextShift' ? state.rows : [];
  const lead = rows[0];
  const remaining = isMedium ? rows.slice(1, 4) : [];
  // One row and no pending: the right column has nothing to say, so it is
  // omitted and the hero takes the width it frees.
  const wideHero = isMedium && remaining.length === 0 && !pending;

  // Art appears on `startingSoon` and on the empty states only — never on a
  // flipped card, where an illustration would undercut what the amber is
  // doing, and never on the data-dense states.
  const artUri = dark ? props.artDarkUri : props.artLightUri;
  // `systemSmall` only: every medium and accessory family stays typographic.
  const showArt =
    !isAccessory &&
    !isMedium &&
    !pending &&
    Boolean(artUri) &&
    (state.kind === 'startingSoon' ||
      state.kind === 'empty' ||
      state.kind === 'neverSynced');
  const artSize = state.kind === 'startingSoon' ? 64 : 72;
  // The illustration bleeds off the bottom-trailing corner, so the hero needs
  // a gutter it cannot run into. `offset` does not affect layout, which is
  // exactly why the reservation has to be explicit — on device, "No shifts in
  // the next two weeks" set straight across the roof of the house without it.
  const artGutter = showArt ? artSize - 24 : 0;

  const glyph = (name: 'calendar' | 'clock' | 'bell.badge.fill') => (
    <Image
      systemName={name}
      size={11}
      modifiers={[
        foregroundStyle(
          pending
            ? OCHRE_FG
            : state.kind === 'startingSoon'
              ? PLUM
              : state.kind === 'shiftStarted'
                ? OCHRE
                : MUTED
        ),
        widgetAccentedRenderingMode('accented'),
        accessibilityHidden(true),
      ]}
    />
  );

  const kickerText = pending ? pending.label : state.title;
  const kickerColor = pending
    ? OCHRE_FG
    : state.kind === 'startingSoon'
      ? PLUM
      : state.kind === 'shiftStarted'
        ? OCHRE
        : MUTED;

  const kickerGlyph = pending ? (
    glyph('bell.badge.fill')
  ) : state.kind === 'nextShift' ? (
    glyph('calendar')
  ) : state.kind === 'startingSoon' ? (
    glyph('clock')
  ) : state.kind === 'shiftStarted' ? (
    glyph('bell.badge.fill')
  ) : state.kind === 'onClock' ? (
    // A live dot, not a glyph — the same mark the in-app card uses.
    <Circle
      modifiers={[frame({ width: 6, height: 6 }), foregroundStyle(APRICOT)]}
    />
  ) : null;

  const kicker = (
    <HStack alignment="center" spacing={5}>
      {kickerGlyph}
      <Text
        modifiers={[
          font({ size: 11, weight: 'semibold' }),
          foregroundStyle(kickerColor),
          lineLimit(1),
          // The kicker shares its row with a glyph and the identity mark, so
          // it has ~110pt on a 158pt card — enough to truncate
          // "Needs your response" to `Needs your re…`. It scales instead.
          minimumScaleFactor(0.75),
        ]}
      >
        {kickerText}
      </Text>
      <Spacer />
      <Image
        systemName="checkmark"
        size={11}
        modifiers={[
          foregroundStyle(pending ? `${OCHRE_FG}59` : `${PLUM}59`),
          widgetAccentedRenderingMode('accented'),
          accessibilityHidden(true),
        ]}
      />
    </HStack>
  );

  const household = (name: string) => (
    <Text modifiers={[font({ size: 13 }), foregroundStyle(SUB), lineLimit(1)]}>
      {name}
    </Text>
  );

  const childrenText = (line: string) => (
    <Text modifiers={[font({ size: 12 }), foregroundStyle(SUB), lineLimit(1)]}>
      {line}
    </Text>
  );

  let hero: ReactElement;
  const spoken: string[] = [kickerText];

  if (pending && !isMedium) {
    // Pending takes the whole small card — kicker AND hero — rather than
    // wearing the amber over another state's figures. The half-measure showed
    // an amber `Needs your response` above the ON-CLOCK time, i.e. a card that
    // shouted about a shift whose day and time it never printed. On-clock
    // status is on the Live Activity anyway; medium keeps both (right column).
    spoken.push(pending.detail);
    hero = (
      <Text
        modifiers={[
          font({ size: 20, weight: 'semibold', design: 'rounded' }),
          foregroundStyle(OCHRE_FG),
          monospacedDigit(),
          lineLimit(2),
          minimumScaleFactor(0.7),
        ]}
      >
        {pending.detail}
      </Text>
    );
  } else if (state.kind === 'neverSynced' || state.kind === 'empty') {
    spoken.push(state.body);
    hero = (
      <Text
        modifiers={[font({ size: 15 }), foregroundStyle(SUB), lineLimit(3)]}
      >
        {state.body}
      </Text>
    );
  } else if (state.kind === 'onClock') {
    spoken.push(state.detail, state.householdName);
    hero = (
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ size: 20, weight: 'semibold', design: 'rounded' }),
            foregroundStyle(INK),
            monospacedDigit(),
            lineLimit(1),
            minimumScaleFactor(0.7),
          ]}
        >
          {state.detail}
        </Text>
        {household(state.householdName)}
      </VStack>
    );
  } else if (state.kind === 'startingSoon') {
    spoken.push(state.time, state.householdName);
    hero = (
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ size: 28, weight: 'semibold', design: 'rounded' }),
            foregroundStyle(INK),
            monospacedDigit(),
            lineLimit(1),
            minimumScaleFactor(0.6),
          ]}
        >
          {state.time}
        </Text>
        {household(state.householdName)}
        {showChildren && state.childrenLine
          ? childrenText(state.childrenLine)
          : null}
      </VStack>
    );
  } else if (state.kind === 'shiftStarted') {
    spoken.push(state.body, state.householdName);
    // The kicker alone carries the ochre; the body stays ink, so the card
    // does not read as two competing warnings.
    hero = (
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ size: 17, weight: 'semibold' }),
            foregroundStyle(INK),
            lineLimit(2),
            minimumScaleFactor(0.9),
          ]}
        >
          {state.body}
        </Text>
        {household(state.householdName)}
      </VStack>
    );
  } else if (lead) {
    spoken.push(lead.dayLabel, lead.timeRange, lead.householdName);
    hero = (
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ size: 13, weight: 'semibold' }),
            foregroundStyle(ACCENT),
            lineLimit(1),
          ]}
        >
          {lead.dayLabel}
        </Text>
        <Text
          modifiers={[
            font({
              size: wideHero ? 28 : 22,
              weight: 'semibold',
              design: 'rounded',
            }),
            foregroundStyle(INK),
            monospacedDigit(),
            lineLimit(1),
            minimumScaleFactor(0.7),
          ]}
        >
          {lead.timeRange}
        </Text>
        {household(lead.householdName)}
        {showChildren && lead.childrenLine
          ? childrenText(lead.childrenLine)
          : null}
      </VStack>
    );
  } else {
    hero = (
      <Text
        modifiers={[font({ size: 15 }), foregroundStyle(SUB), lineLimit(3)]}
      >
        {state.title}
      </Text>
    );
  }

  if (isAccessory) {
    // Lock screen: no colour — the system applies vibrant rendering. The tray
    // is what keeps three lines legible over a busy wallpaper.
    const line1 =
      state.kind === 'nextShift'
        ? (lead?.timeRange ?? state.title)
        : state.kind === 'startingSoon'
          ? state.time
          : state.kind === 'onClock'
            ? state.detail
            : state.title;
    const line2 =
      state.kind === 'nextShift'
        ? lead?.householdName
        : state.kind === 'startingSoon' ||
            state.kind === 'shiftStarted' ||
            state.kind === 'onClock'
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
      <ZStack modifiers={[widgetURL(props.deepLink)]}>
        <AccessoryWidgetBackground />
        <VStack
          alignment="leading"
          spacing={1}
          modifiers={[
            frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'leading' }),
          ]}
        >
          <Text
            modifiers={[font({ size: 11, weight: 'semibold' }), lineLimit(1)]}
          >
            {state.title}
          </Text>
          <Text
            modifiers={[
              font({ size: 15, weight: 'semibold' }),
              monospacedDigit(),
              lineLimit(1),
              minimumScaleFactor(0.7),
            ]}
          >
            {line1}
          </Text>
          {line2 ? (
            <Text modifiers={[font({ size: 11 }), lineLimit(1)]}>{line2}</Text>
          ) : null}
        </VStack>
      </ZStack>
    );
  }

  const heroColumn = (
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[
        frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' }),
      ]}
    >
      {kicker}
      <Spacer />
      <VStack
        alignment="leading"
        spacing={0}
        modifiers={[padding({ trailing: artGutter })]}
      >
        {hero}
      </VStack>
    </VStack>
  );

  // Second dimension on medium: what comes AFTER this one, never more rows
  // of the same thing.
  const showRightColumn =
    isMedium && (remaining.length > 0 || pending !== null);
  const rightColumn = showRightColumn ? (
    <VStack
      alignment="leading"
      spacing={10}
      modifiers={[
        frame({ maxWidth: 150, maxHeight: 10000, alignment: 'topLeading' }),
      ]}
    >
      {remaining.map(row => (
        <HStack
          key={`${row.dayLabel}-${row.timeRange}`}
          alignment="firstTextBaseline"
          spacing={8}
        >
          <Text
            modifiers={[
              font({ size: 12 }),
              foregroundStyle(SUB),
              lineLimit(1),
              frame({ width: 34, alignment: 'leading' }),
            ]}
          >
            {row.dayLabel}
          </Text>
          <Text
            modifiers={[
              font({ size: 13, weight: 'semibold' }),
              foregroundStyle(INK),
              monospacedDigit(),
              lineLimit(1),
            ]}
          >
            {row.timeRange}
          </Text>
        </HStack>
      ))}
      {pending ? (
        <HStack alignment="firstTextBaseline" spacing={6}>
          <Image
            systemName="bell.badge.fill"
            size={11}
            modifiers={[
              foregroundStyle(OCHRE_FG),
              widgetAccentedRenderingMode('accented'),
              accessibilityHidden(true),
            ]}
          />
          <Text
            modifiers={[
              font({ size: 13 }),
              foregroundStyle(OCHRE_FG),
              lineLimit(2),
            ]}
          >
            {pending.detail}
          </Text>
        </HStack>
      ) : null}
    </VStack>
  ) : null;

  const content = showRightColumn ? (
    <HStack
      alignment="top"
      spacing={16}
      modifiers={[
        frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' }),
      ]}
    >
      {heroColumn}
      {rightColumn}
    </HStack>
  ) : (
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[
        frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' }),
      ]}
    >
      {heroColumn}
    </VStack>
  );

  return (
    <ZStack
      alignment="top"
      modifiers={[
        containerBackground(
          pending ? OCHRE : isLive ? CARD_LIVE : CARD,
          'widget'
        ),
        widgetURL(props.deepLink),
        accessibilityElement('combine'),
        // Medium only: on small `pending.detail` IS the hero, so it is
        // already in `spoken` and appending it again would say it twice.
        accessibilityLabel(
          pending && isMedium
            ? `${spoken.join('. ')}. ${pending.detail}`
            : spoken.join('. ')
        ),
      ]}
    >
      {isLive && !pending ? (
        <Rectangle
          modifiers={[
            frame({ height: 76 }),
            // Negative padding cancels WidgetKit's default content margins,
            // which `containerBackground(…,'widget')` opts this card into.
            // Without it the wash is inset on three sides and reads as a pale
            // rectangle drawn ON the card rather than as the card's own warmth.
            padding({ all: -24 }),
            foregroundStyle({
              type: 'linearGradient',
              colors: dark
                ? ['#F2954B21', '#F2954B10', '#F2954B00', '#F2954B00']
                : ['#E8823C29', '#E8823C14', '#E8823C00', '#E8823C00'],
              startPoint: { x: 0.5, y: 0 },
              endPoint: { x: 0.5, y: 1 },
            }),
          ]}
        />
      ) : null}
      {showArt && artUri ? (
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
            uiImage={artUri}
            modifiers={[
              resizable(),
              frame({ width: artSize, height: artSize }),
              offset({
                x: state.kind === 'startingSoon' ? 16 : 14,
                y: state.kind === 'startingSoon' ? 6 : 10,
              }),
              widgetAccentedRenderingMode('accentedDesaturated'),
              accessibilityHidden(true),
            ]}
          />
        </ZStack>
      ) : null}
      {content}
    </ZStack>
  );
}

export const NextShiftWidget = createWidgetSafe(
  'NextShift',
  NextShiftWidgetView
);

registerWidgetTargets({ nextShift: NextShiftWidget });

/**
 * @module widgets/TodaysCoverWidget
 *
 * P1 — the parent's "today's cover" home-screen widget. `systemSmall`,
 * `systemMedium`, `accessoryRectangular`. Mirrors `NannyLiveStatusCard`'s
 * row ordering, already applied by `buildTodaysCoverPayload`; this file only
 * renders the rows it is given and picks fresh vs. stale text per row.
 *
 * The card's GROUND is the parent-facing payoff: warm apricot-tinted card =
 * someone is with the kids right now, neutral card = nobody is. That reads
 * across a room, which no amount of 13pt text achieves, and it is the same
 * `liveCardBackground()` fill `NannyLiveStatusCard` uses in-app.
 *
 * See `NextShiftWidget.tsx`'s header (and `OnTheClock.tsx`'s, in full) for
 * why this is one self-contained `'widget'`-directive function with no repo
 * imports beyond erased `import type`. The staleness/row-cap logic here
 * duplicates `widgets/lib/render.ts`, which is unit-tested there — this
 * component cannot render outside WidgetKit, so it is not tested directly.
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

import { createWidgetSafe } from '@/src/lib/expoWidgets';

import { registerWidgetTargets } from '@/src/lib/widgetSnapshot';
import type { TodaysCoverWidgetProps } from '@/src/lib/widgetSnapshot.types';

function TodaysCoverWidgetView(
  props: TodaysCoverWidgetProps,
  env: WidgetEnvironment
) {
  'widget';
  const dark = env.colorScheme === 'dark';
  const FG = dark ? '#F1EAF0' : '#2A1F2B';
  const MUTED = dark ? '#B2A4B3' : '#6E6270';
  const CARD = dark ? '#241C26' : '#FFFFFF';
  // `liveCardBackground()` from lib/design-tokens/elevation.ts — highlight
  // mixed onto card at 8%, opaque. Pinned in this widget's palette test.
  const CARD_LIVE = dark ? '#342629' : '#FDF5EF';
  const PLUM = dark ? '#C9A2CB' : '#5B3E5D';
  const OCHRE = dark ? '#E0B061' : '#C08A3E';
  const APRICOT = dark ? '#F2954B' : '#E8823C';

  const family = env.widgetFamily;
  const isAccessory = family === 'accessoryRectangular';
  const isMedium = family === 'systemMedium';

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

  // `containerBackground` takes a Color only, so the apricot wash is a
  // fixed-height Rectangle as the first child of the root ZStack. Four evenly
  // spaced stops land the fade at 0.667, matching `washGradient()`'s 0.62
  // within 5% — there is no location array in this binding. Alpha is LAST
  // (#RRGGBBAA): 0x29 = 16%, 0x21 = 13%, matching elevation.ts.
  const wash = (
    <Rectangle
      modifiers={[
        frame({ height: 76 }),
        // Negative padding cancels WidgetKit's default content margins, which
        // `containerBackground(…,'widget')` opts this card into. Without it the
        // wash is inset on three sides and reads as a pale rectangle drawn ON
        // the card rather than as the card's own warmth.
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
  );

  // No snapshot has ever reached this widget: never signed in, or a parent
  // added it to a nanny's phone (nobody feeds the other persona's widgets —
  // see `useWidgetSnapshotSync`'s header). Every prop is `undefined` here, so
  // this guard comes before any of them is read. English literal unless the snapshot
  // is a wrong-persona REDIRECT, which carries pre-localized
  // `fallbackTitle`/`fallbackBody` — the only localized copy that reaches
  // this branch, since the widget has no i18n runtime.
  if (!props.rows) {
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

  const ageMs = Math.max(
    0,
    env.date.getTime() - new Date(props.generatedAtIso).getTime()
  );
  // `SNAPSHOT_DEGRADE_MS` / `SNAPSHOT_AS_OF_MS` from
  // `lib/widgetSnapshot.types.ts`, inlined: this body is serialized to source
  // and evaluated with no module scope, so a reference to either name is a
  // `ReferenceError` at render — which is exactly how this shipped once.
  // `__tests__/TodaysCoverWidget.palette.test.ts` pins both figures.
  const stale = ageMs > 45 * 60 * 1000;
  const showAsOf = ageMs > 2 * 60 * 60 * 1000;

  if (props.rows.length === 0) {
    // `systemSmall` only (spec §8: every medium family stays typographic), and
    // the text reserves a gutter — `offset` does not affect layout, so without
    // one the sentence sets straight across the illustration.
    const emptyArt = isMedium
      ? null
      : dark
        ? props.artDarkUri
        : props.artLightUri;
    const body = (
      <VStack
        alignment="leading"
        spacing={2}
        modifiers={[padding({ trailing: emptyArt ? 48 : 0 })]}
      >
        <Text
          modifiers={[
            font({ size: 17, weight: 'semibold' }),
            foregroundStyle(FG),
            lineLimit(3),
            minimumScaleFactor(0.9),
          ]}
        >
          {props.emptyTitle}
        </Text>
        <Text
          modifiers={[font({ size: 12 }), foregroundStyle(MUTED), lineLimit(2)]}
        >
          {props.emptyBody}
        </Text>
      </VStack>
    );
    if (isAccessory) return body;
    return (
      <ZStack
        modifiers={[
          containerBackground(CARD, 'widget'),
          widgetURL(props.deepLink),
          accessibilityElement('combine'),
          accessibilityLabel(`${props.emptyTitle}. ${props.emptyBody}`),
        ]}
      >
        {emptyArt ? (
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
              uiImage={emptyArt}
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
          spacing={0}
          modifiers={[
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
            {props.title}
          </Text>
          <Spacer />
          {body}
        </VStack>
      </ZStack>
    );
  }

  const lead = props.rows[0];
  // Only a fresh snapshot may claim someone is on the clock right now.
  const live = !stale && lead ? lead.isLiveDot : false;

  const leadTitle = lead ? (stale ? lead.staleTitle : lead.title) : '';
  const leadDetail = lead ? (stale ? lead.staleDetail : lead.detail) : null;

  if (isAccessory) {
    // Never medium here, and the empty case already returned — exactly one row.
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
            modifiers={[
              font({ size: 13, weight: 'semibold' }),
              lineLimit(2),
              minimumScaleFactor(0.85),
            ]}
          >
            {leadTitle}
          </Text>
          {leadDetail ? (
            <Text
              modifiers={[font({ size: 11 }), monospacedDigit(), lineLimit(1)]}
            >
              {leadDetail}
            </Text>
          ) : null}
        </VStack>
      </ZStack>
    );
  }

  const kicker = (
    <HStack alignment="center" spacing={6}>
      {live ? (
        <Circle
          modifiers={[frame({ width: 6, height: 6 }), foregroundStyle(APRICOT)]}
        />
      ) : null}
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

  // The hero is a locked full sentence — a phrase hero at 17pt, not a scalar.
  const hero = (
    <VStack alignment="leading" spacing={2}>
      <Text
        modifiers={[
          font({ size: 17, weight: 'semibold' }),
          foregroundStyle(lead && lead.kind === 'gap' ? OCHRE : FG),
          lineLimit(3),
          minimumScaleFactor(0.9),
        ]}
      >
        {leadTitle}
      </Text>
      {leadDetail ? (
        <Text
          modifiers={[
            font({ size: 12 }),
            foregroundStyle(MUTED),
            monospacedDigit(),
            lineLimit(1),
          ]}
        >
          {leadDetail}
        </Text>
      ) : null}
    </VStack>
  );

  // Stale rows contribute `staleTitle`: the spoken label must not assert what
  // the visual has retracted.
  const rest = isMedium ? props.rows.slice(1, 4) : [];
  const spokenLabel = [
    props.title,
    ...[lead, ...rest].map(row =>
      row
        ? `${stale ? row.staleTitle : row.title}${
            (stale ? row.staleDetail : row.detail)
              ? `. ${stale ? row.staleDetail : row.detail}`
              : ''
          }`
        : ''
    ),
    showAsOf ? props.asOfLabel : '',
  ]
    .filter(part => part.length > 0)
    .join('. ');

  const asOf = showAsOf ? (
    <Text
      modifiers={[font({ size: 11 }), foregroundStyle(MUTED), lineLimit(1)]}
    >
      {props.asOfLabel}
    </Text>
  ) : null;

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
      {hero}
      {!isMedium && props.moreLabel ? (
        <Text
          modifiers={[font({ size: 11 }), foregroundStyle(MUTED), lineLimit(1)]}
        >
          {props.moreLabel}
        </Text>
      ) : null}
      {asOf}
    </VStack>
  );

  // Second dimension on medium: now (left) vs. the rest of today (right) —
  // but only when there IS a rest. A reserved-but-empty 150pt column is 150pt
  // the hero could have used, and on device it truncated the lead row's detail
  // to `On the clock since 4:59…` on a 338pt card with half of it blank.
  const content =
    isMedium && rest.length > 0 ? (
      <HStack
        alignment="top"
        spacing={16}
        modifiers={[
          frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' }),
        ]}
      >
        {heroColumn}
        <VStack
          alignment="leading"
          spacing={10}
          modifiers={[
            frame({
              maxWidth: 150,
              maxHeight: 10000,
              alignment: 'topLeading',
            }),
          ]}
        >
          {rest.map(row => (
            <HStack key={row.key} alignment="firstTextBaseline" spacing={7}>
              <Circle
                modifiers={[
                  frame({ width: 5, height: 5 }),
                  foregroundStyle(
                    row.kind === 'gap'
                      ? OCHRE
                      : row.kind === 'finished'
                        ? MUTED
                        : PLUM
                  ),
                ]}
              />
              <VStack alignment="leading" spacing={1}>
                <Text
                  modifiers={[
                    font({ size: 12 }),
                    foregroundStyle(FG),
                    lineLimit(1),
                  ]}
                >
                  {stale ? row.staleTitle : row.title}
                </Text>
                {(stale ? row.staleDetail : row.detail) ? (
                  <Text
                    modifiers={[
                      font({ size: 11 }),
                      foregroundStyle(MUTED),
                      monospacedDigit(),
                      lineLimit(1),
                    ]}
                  >
                    {stale ? row.staleDetail : row.detail}
                  </Text>
                ) : null}
              </VStack>
            </HStack>
          ))}
        </VStack>
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
        containerBackground(live ? CARD_LIVE : CARD, 'widget'),
        widgetURL(props.deepLink),
        accessibilityElement('combine'),
        accessibilityLabel(spokenLabel),
      ]}
    >
      {live ? wash : null}
      {content}
    </ZStack>
  );
}

export const TodaysCoverWidget = createWidgetSafe(
  'TodaysCover',
  TodaysCoverWidgetView
);

registerWidgetTargets({ todaysCover: TodaysCoverWidget });

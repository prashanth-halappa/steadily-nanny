/**
 * @module widgets/TodaysCoverWidget
 *
 * P1 — the parent's "today's cover" home-screen widget. `systemSmall`,
 * `systemMedium`, `accessoryRectangular`. Mirrors `NannyLiveStatusCard`'s
 * row ordering, already applied by `buildTodaysCoverPayload`; this file only
 * renders the rows it is given and picks fresh vs. stale text per row.
 *
 * See `NextShiftWidget.tsx`'s header (and `OnTheClock.tsx`'s, in full) for
 * why this is one self-contained `'widget'`-directive function with no repo
 * imports beyond erased `import type`. The staleness/row-cap logic here
 * duplicates `widgets/lib/render.ts`, which is unit-tested there — this
 * component cannot render outside WidgetKit, so it is not tested directly.
 */
import { Circle, HStack, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
  padding,
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
  const OCHRE = dark ? '#E0B061' : '#C08A3E';
  const APRICOT = dark ? '#F2954B' : '#E8823C';

  const family = env.widgetFamily;
  const isAccessory = family === 'accessoryRectangular';
  const isMedium = family === 'systemMedium';

  // No snapshot has ever reached this widget: never signed in, or a parent
  // added it to a nanny's phone (nobody feeds the other persona's widgets —
  // see `useWidgetSnapshotSync`'s header). Every prop is `undefined` here, so
  // this guard comes before any of them is read. English literal on purpose:
  // the localized copy travels IN the snapshot, and there isn't one.
  if (!props.rows) {
    const fallback = (
      <VStack alignment="leading" spacing={4}>
        <Text
          modifiers={[
            font({ size: 13, weight: 'semibold' }),
            foregroundStyle(FG),
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

  // systemSmall shows the top row + moreLabel; systemMedium fits a few more.
  const rows = isMedium ? props.rows.slice(0, 4) : props.rows.slice(0, 1);

  if (props.rows.length === 0) {
    const body = (
      <VStack alignment="leading" spacing={4}>
        <Text
          modifiers={[
            font({ size: 13, weight: 'semibold' }),
            foregroundStyle(FG),
          ]}
        >
          {props.emptyTitle}
        </Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
          {props.emptyBody}
        </Text>
      </VStack>
    );
    return isAccessory ? (
      body
    ) : (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[padding({ all: 14 }), widgetURL(props.deepLink)]}
      >
        {body}
      </VStack>
    );
  }

  const rowView = (row: (typeof props.rows)[number]) => {
    const title = stale ? row.staleTitle : row.title;
    const detail = stale ? row.staleDetail : row.detail;
    const showDot = !stale && row.isLiveDot;
    const isGap = row.kind === 'gap';
    return (
      <VStack key={row.key} alignment="leading" spacing={2}>
        <HStack spacing={6}>
          {showDot ? (
            <Circle
              modifiers={[
                frame({ width: 6, height: 6 }),
                foregroundStyle(APRICOT),
              ]}
            />
          ) : null}
          <Text
            modifiers={[
              font({ size: 13, weight: 'semibold' }),
              foregroundStyle(isGap ? OCHRE : FG),
            ]}
          >
            {title}
          </Text>
        </HStack>
        {detail ? (
          <Text
            modifiers={[
              font({ size: 12 }),
              foregroundStyle(MUTED),
              monospacedDigit(),
            ]}
          >
            {detail}
          </Text>
        ) : null}
      </VStack>
    );
  };

  if (isAccessory) {
    // `rows` is `props.rows.slice(0, 1)` here (accessory is never medium),
    // and the empty-rows case already returned above — always exactly one.
    return (
      <VStack
        alignment="leading"
        spacing={1}
        modifiers={[widgetURL(props.deepLink)]}
      >
        {rows.map(rowView)}
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
      <VStack alignment="leading" spacing={10}>
        {rows.map(rowView)}
      </VStack>
      {!isMedium && props.moreLabel ? (
        <Text modifiers={[font({ size: 12 }), foregroundStyle(MUTED)]}>
          {props.moreLabel}
        </Text>
      ) : null}
      {showAsOf ? (
        <Text modifiers={[font({ size: 11 }), foregroundStyle(MUTED)]}>
          {props.asOfLabel}
        </Text>
      ) : null}
    </VStack>
  );
}

export const TodaysCoverWidget = createWidgetSafe(
  'TodaysCover',
  TodaysCoverWidgetView
);

registerWidgetTargets({ todaysCover: TodaysCoverWidget });

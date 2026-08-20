/**
 * @module widgets/OnTheClock
 *
 * The nanny's Live Activity: "am I actually on the clock?" answered on the
 * lock screen and in the Dynamic Island, without unlocking the phone.
 *
 * ── The one rule that shapes this whole file ────────────────────────────
 * A function carrying the `'widget'` directive is NOT bundled. Babel
 * (`babel-preset-expo`'s widgets-plugin) replaces it with a STRING of its
 * own source, which `WidgetsJSRuntime.swift` evaluates in a bare
 * JavaScriptCore context inside the extension. That context has exactly the
 * globals `expo-widgets`' `bundle/index.ts` installs — every
 * `@expo/ui/swift-ui` view, every modifier, the JSX runtime shims — and
 * nothing else.
 *
 * So `OnTheClockView` may only reference identifiers that exist as globals
 * out there: the `@expo/ui/swift-ui` views and modifiers, whose imports
 * below are for TypeScript's benefit and happen to share the globals' names
 * (the plugin runs before the CommonJS transform, so the serialized source
 * still says `Text`, not `_swiftUi.Text`). It may NOT reference a module
 * constant, a sibling helper, or anything from this repo — those identifiers
 * do not exist where it runs, and the failure mode is a red box in
 * extension logs, not a compile error. Hence the palette hexes live INSIDE
 * the function body; `__tests__/OnTheClock.palette.test.ts` keeps them
 * honest against `palette.dark`.
 *
 * ── What is the hero ───────────────────────────────────────────────────
 * The clock-in time. Everything else on the banner — the household, the
 * scheduled finish, the bar — is support at 13pt, and Clock out is an
 * intrinsic-width pill rather than a full-width slab, so the card states
 * where she is before it offers her the one action. The one exception is
 * overdue, where the whole card flips to `warning` with `warningForeground`
 * ink (9.13:1) and Clock out becomes the loudest object, correctly.
 *
 * ── No ticking digits, and no system-formatted times ───────────────────
 * App-wide rule: no user-visible time ever shows seconds. `Text(timerInterval:)`
 * always does, so it is never used here — and of `Text`'s `dateStyle`s,
 * `'relative'`, `'offset'` and `'timer'` all tick seconds under a minute.
 *
 * `Text(date:style:)` is not used either, for a second reason: SwiftUI
 * formats it in the DEVICE's timezone, while every time string in this app is
 * formatted in the HOUSEHOLD's. The Dynamic Island's scalar shipped that way
 * once and read `2:26 PM` beside a banner saying `Scheduled finish 10:26 PM`
 * — the same instant, twice, disagreeing. So the island reads
 * `finishTimeShort`, which `buildRunningProps` fills from the same
 * `formatClockTime(…, timeZone)` call that builds `finishLabel`.
 *
 * `ProgressView(timerInterval:)` was the original plan — self-animating, no
 * pushes, no app wake — and it shipped a ticking `2:41:50` into the expanded
 * Dynamic Island, overflowing its 4pt frame and drawing over the Clock out
 * button. That text is not the label: `@expo/ui`'s ProgressView calls
 * SwiftUI's `init(timerInterval:countsDown:label:)`, whose DEFAULT
 * `currentValueLabel` is the running timer. Only the four-argument init can
 * replace it, and `@expo/ui` exposes no `currentValueLabel` — so no
 * combination of props or modifiers can suppress it. `labelsHidden()` does
 * not: it hides the label, which is a different slot.
 *
 * So the bar is a determinate `ProgressView(value:)` — `init(value:total:label:)`
 * has no current-value label at all — with the fraction computed here at
 * render. It advances every time iOS draws the activity, which is the same
 * mechanism the overdue flip below already rides on. What that costs is
 * animation BETWEEN redraws, and at nine hours a shift bar moves 0.2% per
 * minute: motion nobody could see anyway. Times stay static labelled figures.
 *
 * ── How the overdue state flips, and what drives it ───────────────────
 * The threshold rides in the props as `overdueAtIso` and the comparison
 * happens HERE, at render, against the extension's own clock.
 *
 * This file used to claim that needed no app, "only a re-render, which iOS
 * performs whenever it draws the activity". That is WRONG, and it cost a
 * validation round: on device the card was still apricot 13 minutes past
 * its threshold (10:39:45) at 10:52:14, through several forced redraws.
 * Drawing the activity does not re-run this body. ActivityKit's mechanism
 * for a scheduled re-render is `staleDate`, and `expo-widgets` hardcodes it
 * to `nil` (`ios/LiveActivity.swift`, `ios/LiveActivityFactory.swift`) with
 * no way to set it — so the body re-runs ONLY when something calls
 * `update()`.
 *
 * So the app drives it: `useLiveActivitySync` arms a timer for
 * `overdueAtIso` and calls `pokeOverdueRedraw` (`src/lib/liveActivity.ts`),
 * an update with unchanged props whose only job is to force this
 * re-evaluation. The honest ceiling: with the app process dead AND never
 * reopened, nothing pokes and the flip waits for the next launch — the
 * clock-out reminder notification is what gets her there.
 *
 * ponytail: the real fix is a native `staleDate` on the ActivityContent,
 * which is a patch to expo-widgets, not to this repo. Do that instead of
 * elaborating the poke if the timer ever proves unreliable.
 */
import {
  HStack,
  Image,
  Link,
  ProgressView,
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
  activityBackgroundTint,
  background,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  offset,
  padding,
  progressViewStyle,
  resizable,
  tint,
  widgetAccentedRenderingMode,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivitySafe } from '@/src/lib/expoWidgets';

/** Running: on the clock. Matched/unmatched/overdue are all derived. */
export interface OnTheClockRunningProps {
  phase: 'running';
  /** "You're on the clock" — pre-localized in the app, no i18n out here. */
  title: string;
  /** "Patel household". Never dropped: multi-household wrong-door risk. */
  household: string;
  /** "Clocked in 08:12". THE HERO — 20pt rounded on the banner. */
  clockedInLabel: string;
  /** "Scheduled finish 17:00", or null when the clock-in matched no shift. */
  finishLabel: string | null;
  /**
   * Just the time out of `finishLabel` — "17:00" — for the Dynamic Island,
   * which has no room for the sentence. Formatted in the HOUSEHOLD's zone by
   * the app, like every other time string here: `Text(date:style:.time)`
   * would have the system format it in the DEVICE's zone, and the island then
   * contradicts the banner beside it whenever the two zones differ.
   *
   * Optional because a Live Activity outlives an app update: one started by a
   * build before this field existed keeps rendering, and the island simply
   * shows nothing until the next clock-in.
   */
  finishTimeShort?: string | null;
  /** "No scheduled shift today.", or null when a shift was matched. */
  unmatchedNote: string | null;
  /** "Past 17:00 — still working?" */
  overdueTitle: string;
  /** "Clock out when you're done." */
  overdueNote: string;
  /**
   * When this entry stops being plausible, ISO. Frozen at LA start from the
   * same `resolveOverdueAtMs` the in-app card uses.
   */
  overdueAtIso: string;
  /** The agreed shift window, ISO — drives the progress bar. Frozen at start. */
  scheduledStartIso: string | null;
  scheduledEndIso: string | null;
  /** "Clock out" */
  clockOutLabel: string;
  /** Deep link into ClockOutSheet — never a one-tap clock-out (D20). */
  clockOutUrl: string;
  /** Deep link for the body tap: the Today tab. */
  bodyUrl: string;
  /**
   * `file://` URI of the lit-window illustration in the App Group container,
   * or null. Null is the fallback: the banner drops the image AND the trailing
   * gutter it reserves, and loses nothing — the art carries no information.
   * A Live Activity is dark-only, so there is one URI, not a light/dark pair.
   *
   * OPTIONAL, not required: `src/lib/liveActivity.ts` does not set it yet (the
   * art lands separately) and an unset field must not break a running
   * activity. Unset behaves exactly as null.
   */
  artUri?: string | null;
}

/** The 90-second receipt shown in place of the running activity. */
export interface OnTheClockReceiptProps {
  phase: 'receipt';
  /** "✓ Clocked out at 17:04" */
  title: string;
  /** "8h 52m recorded · Break 30m" */
  detail: string;
  /** Deep link to the Hours tab — this IS the "fix my break" moment. */
  bodyUrl: string;
  /** As `OnTheClockRunningProps.artUri`; the window-dark variant. */
  artUri?: string | null;
}

export type OnTheClockProps = OnTheClockRunningProps | OnTheClockReceiptProps;

function OnTheClockView(props: OnTheClockProps) {
  'widget';
  // Daylight `palette.dark` (lib/design-tokens/palette.ts). Inlined, not
  // imported — see this module's header for why that is not optional.
  const BG = '#1B151C'; // background — also the ink on the overdue card
  const FG = '#F1EAF0'; // foreground
  const MUTED = '#4E4350'; // mutedStrong
  const APRICOT = '#F2954B'; // highlight
  const OCHRE = '#E0B061'; // warning
  const GREEN = '#6FB98A'; // success
  const CARD = '#241C26'; // card
  // `liveCardBackground('dark')` from lib/design-tokens/elevation.ts —
  // highlight mixed onto card at 8%. The same ground as the in-app live card.
  const CARD_LIVE = '#342629';

  const isReceipt = props.phase === 'receipt';
  const overdue =
    !isReceipt && Date.now() >= new Date(props.overdueAtIso).getTime();
  // The bar only exists when a real scheduled window was matched at start.
  // Separate locals rather than one expression so the union stays narrowed.
  const startMs =
    !isReceipt && props.scheduledStartIso
      ? new Date(props.scheduledStartIso).getTime()
      : null;
  const endMs =
    !isReceipt && props.scheduledEndIso
      ? new Date(props.scheduledEndIso).getTime()
      : null;
  const barValue =
    startMs !== null && endMs !== null && endMs > startMs
      ? Math.min(1, Math.max(0, (Date.now() - startMs) / (endMs - startMs)))
      : null;

  const accent = isReceipt ? GREEN : overdue ? OCHRE : APRICOT;
  // Overdue flips the whole card, so its ink is `warningForeground`, not the
  // dark-mode foreground. `mutedForeground` is 3.10:1 on amber and never appears there;
  // secondary lines shed size, not colour.
  const INK = overdue && !isReceipt ? BG : FG;
  const SUB = overdue && !isReceipt ? BG : MUTED;

  const headline = isReceipt
    ? props.title
    : overdue
      ? props.overdueTitle
      : props.title;

  const glyphName = overdue
    ? 'exclamationmark.circle.fill'
    : isReceipt
      ? 'checkmark.circle.fill'
      : 'clock.fill';

  const bar =
    barValue !== null ? (
      <ProgressView
        value={barValue}
        modifiers={[
          progressViewStyle('linear'),
          frame({ height: 4 }),
          tint(overdue ? BG : APRICOT),
        ]}
      />
    ) : null;

  // The scheduled finish, pre-formatted in the household's zone by the app —
  // never `Text(date:style:.time)`, which formats in the DEVICE's zone and so
  // disagrees with `finishLabel` on the same card the moment the two differ.
  const finishScalar =
    !isReceipt && props.finishTimeShort ? (
      <Text
        modifiers={[
          font({ size: 14, weight: 'semibold', design: 'rounded' }),
          foregroundStyle(FG),
          monospacedDigit(),
          lineLimit(1),
          minimumScaleFactor(0.8),
        ]}
      >
        {props.finishTimeShort}
      </Text>
    ) : null;

  const supportLine = isReceipt
    ? props.detail
    : overdue
      ? props.overdueNote
      : (props.finishLabel ?? props.unmatchedNote);

  const compactGlyph = (size: number) => (
    <Image
      systemName={glyphName}
      size={size}
      modifiers={[foregroundStyle(accent)]}
    />
  );

  // Ghost-quiet while things are ordinary, the loudest object once overdue —
  // the one moment clocking out is the only thing worth doing.
  const clockOutButton = isReceipt ? null : (
    <Link destination={props.clockOutUrl}>
      <Text
        modifiers={[
          font({ size: 15, weight: 'semibold' }),
          foregroundStyle(FG),
          padding({ horizontal: 22 }),
          // `minHeight`, not `height`: @expo/ui's FrameModifier drops every
          // min/max field the moment a fixed width or height is set, so
          // `{ maxWidth, height }` would silently collapse this to the width
          // of its own label. 10000 stands in for `.infinity`, which cannot
          // survive the JSON hop to native.
          overdue
            ? frame({ maxWidth: 10000, minHeight: 44, alignment: 'center' })
            : frame({ minHeight: 44, alignment: 'center' }),
          background(overdue ? BG : '#2E2431'),
          cornerRadius(14),
        ]}
      >
        {props.clockOutLabel}
      </Text>
    </Link>
  );

  const spokenLabel = isReceipt
    ? `${props.title}. ${props.detail}`
    : `${headline}. ${props.household}. ${props.clockedInLabel}. ${
        supportLine ?? ''
      }`;

  // Receipt: not live. Neutral card ground, no wash, and NO glyph — the `✓`
  // inside the locked title is the glyph.
  const receiptBody = isReceipt ? (
    <VStack
      alignment="leading"
      spacing={6}
      modifiers={[
        padding({ all: 14 }),
        frame({ maxWidth: 10000, alignment: 'leading' }),
        accessibilityElement('combine'),
        accessibilityLabel(spokenLabel),
      ]}
    >
      <Text
        modifiers={[
          font({ size: 16, weight: 'semibold' }),
          foregroundStyle(GREEN),
          lineLimit(1),
          minimumScaleFactor(0.85),
        ]}
      >
        {props.title}
      </Text>
      <Text
        modifiers={[
          font({ size: 13 }),
          foregroundStyle(SUB),
          monospacedDigit(),
          lineLimit(1),
          minimumScaleFactor(0.85),
        ]}
      >
        {props.detail}
      </Text>
    </VStack>
  ) : null;

  const runningBody = isReceipt ? null : (
    <VStack
      alignment="leading"
      spacing={10}
      modifiers={[
        padding({ all: 14 }),
        frame({ maxWidth: 10000, alignment: 'leading' }),
      ]}
    >
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[
          // The trailing gutter is reserved for the illustration; with no
          // art there is nothing to clear, so the text takes the full width.
          props.artUri && !overdue
            ? padding({ trailing: 56 })
            : padding({ trailing: 0 }),
          accessibilityElement('combine'),
          accessibilityLabel(spokenLabel),
        ]}
      >
        <HStack alignment="center" spacing={8}>
          <Image
            systemName={glyphName}
            size={15}
            modifiers={[foregroundStyle(overdue ? BG : APRICOT)]}
          />
          <Text
            modifiers={[
              font({ size: 16, weight: 'semibold' }),
              foregroundStyle(INK),
              lineLimit(1),
              minimumScaleFactor(0.85),
            ]}
          >
            {headline}
          </Text>
          <Spacer />
          {/* Household pairs "which door" with "which state", where the
              wrong-door risk actually lives — and it saves a row. */}
          <Text
            modifiers={[font({ size: 13 }), foregroundStyle(SUB), lineLimit(1)]}
          >
            {props.household}
          </Text>
        </HStack>
        <Text
          modifiers={[
            font({ size: 20, weight: 'semibold', design: 'rounded' }),
            foregroundStyle(INK),
            monospacedDigit(),
            lineLimit(1),
            minimumScaleFactor(0.8),
          ]}
        >
          {props.clockedInLabel}
        </Text>
        {supportLine ? (
          <Text
            modifiers={[
              font({ size: 13 }),
              foregroundStyle(SUB),
              monospacedDigit(),
              lineLimit(1),
              minimumScaleFactor(0.85),
            ]}
          >
            {supportLine}
          </Text>
        ) : null}
        {bar}
      </VStack>
      {clockOutButton}
    </VStack>
  );

  const banner = (
    <ZStack
      alignment="top"
      modifiers={[
        activityBackgroundTint(isReceipt ? CARD : overdue ? OCHRE : CARD_LIVE),
        widgetURL(props.bodyUrl),
      ]}
    >
      {/* `activityBackgroundTint` takes a flat Color, so the wash is a
          fixed-height Rectangle — a flexible one would inflate the activity
          to its 160pt maximum. Alpha is LAST (#RRGGBBAA). Never on the
          overdue card: there, the colour IS the card. */}
      {isReceipt || overdue ? null : (
        <Rectangle
          modifiers={[
            frame({ height: 96 }),
            foregroundStyle({
              type: 'linearGradient',
              colors: ['#F2954B21', '#F2954B10', '#F2954B00', '#F2954B00'],
              startPoint: { x: 0.5, y: 0 },
              endPoint: { x: 0.5, y: 1 },
            }),
          ]}
        />
      )}
      {props.artUri && !overdue ? (
        <ZStack
          modifiers={[
            frame({
              maxWidth: 10000,
              maxHeight: 10000,
              alignment: 'topTrailing',
            }),
            padding(
              isReceipt ? { top: 6, trailing: 10 } : { top: 8, trailing: 8 }
            ),
          ]}
        >
          <Image
            uiImage={props.artUri}
            modifiers={[
              resizable(),
              isReceipt
                ? frame({ width: 48, height: 48 })
                : frame({ width: 64, height: 64 }),
              offset({ x: isReceipt ? 10 : 14, y: 0 }),
              widgetAccentedRenderingMode('accentedDesaturated'),
              accessibilityHidden(true),
            ]}
          />
        </ZStack>
      ) : null}
      {isReceipt ? receiptBody : runningBody}
    </ZStack>
  );

  return {
    banner,
    // No circular ProgressView: at 16pt and low progress it renders as a
    // hollow ring that reads "loading", the wrong signal for a 9-hour shift.
    minimal: compactGlyph(14),
    compactLeading: compactGlyph(14),
    compactTrailing: finishScalar,
    expandedLeading: (
      <HStack
        alignment="center"
        spacing={6}
        modifiers={[padding({ leading: 4 })]}
      >
        <Image
          systemName={glyphName}
          size={13}
          modifiers={[foregroundStyle(accent)]}
        />
        {isReceipt ? null : (
          <Text
            modifiers={[font({ size: 13 }), foregroundStyle(SUB), lineLimit(1)]}
          >
            {props.household}
          </Text>
        )}
      </HStack>
    ),
    expandedTrailing: isReceipt ? null : (
      <VStack modifiers={[padding({ trailing: 4 })]}>
        {props.finishTimeShort ? (
          <Text
            modifiers={[
              font({ size: 15, weight: 'semibold', design: 'rounded' }),
              foregroundStyle(FG),
              monospacedDigit(),
              lineLimit(1),
              minimumScaleFactor(0.8),
            ]}
          >
            {props.finishTimeShort}
          </Text>
        ) : null}
      </VStack>
    ),
    // The headline lives in the full-width bottom region: that is what stops
    // "You're on / the clock" wrapping in the leading slot. 4pt side padding
    // keeps content off the island's 44pt corner radius.
    expandedBottom: (
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[padding({ horizontal: 4, bottom: 2 })]}
      >
        {/* `combine` on the CONTENT, never the root — combining across the
            Link would swallow the only action on the surface. */}
        <VStack
          alignment="leading"
          spacing={8}
          modifiers={[
            frame({ maxWidth: 10000, alignment: 'leading' }),
            accessibilityElement('combine'),
            accessibilityLabel(spokenLabel),
          ]}
        >
          <Text
            modifiers={[
              font({ size: 15, weight: 'semibold' }),
              foregroundStyle(isReceipt ? GREEN : FG),
              lineLimit(1),
              minimumScaleFactor(0.8),
            ]}
          >
            {headline}
          </Text>
          {isReceipt || !supportLine ? null : (
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(SUB),
                monospacedDigit(),
                lineLimit(1),
              ]}
            >
              {supportLine}
            </Text>
          )}
          {isReceipt ? (
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(SUB),
                monospacedDigit(),
                lineLimit(1),
              ]}
            >
              {props.detail}
            </Text>
          ) : null}
          {bar}
        </VStack>
        {clockOutButton}
      </VStack>
    ),
  };
}

/**
 * `'OnTheClock'` is the activity name the extension looks up; nothing in
 * `app.config.js` needs to list it (the generated `WidgetLiveActivity()` in
 * the widget bundle serves every Live Activity and dispatches on this name).
 *
 * Constructing the factory REGISTERS the layout with the native module, so
 * this module is imported lazily from `src/lib/liveActivity.ts` rather than
 * at app start.
 */
export const OnTheClockActivity = createLiveActivitySafe<OnTheClockProps>(
  'OnTheClock',
  OnTheClockView
);

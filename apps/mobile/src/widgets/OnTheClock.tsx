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
 * ── No ticking digits ──────────────────────────────────────────────────
 * App-wide rule: no user-visible time ever shows seconds. `Text(timerInterval:)`
 * always does, so it is never used here.
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
 * ── How the overdue state flips with the app asleep ────────────────────
 * ActivityKit's own mechanism for this is `staleDate`, which `expo-widgets`
 * hardcodes to `nil` (`ios/LiveActivity.swift`) and does not expose. So the
 * threshold rides in the props as `overdueAtIso` and the comparison happens
 * HERE, at render, against the extension's own clock. That needs no push
 * and no running app — only a re-render, which iOS performs whenever it
 * draws the activity. Weaker than `staleDate` (which guarantees a redraw at
 * the instant), so treat the flip as "by the next time she looks", not "at
 * 17:30 exactly". See `src/lib/liveActivity.ts` for where the instant is
 * computed (one shared rule with the in-app card).
 */
import {
  Circle,
  HStack,
  Link,
  ProgressView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  background,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
  padding,
  progressViewStyle,
  tint,
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
  /** "Clocked in 08:12". */
  clockedInLabel: string;
  /** "Scheduled finish 17:00", or null when the clock-in matched no shift. */
  finishLabel: string | null;
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
}

export type OnTheClockProps = OnTheClockRunningProps | OnTheClockReceiptProps;

function OnTheClockView(props: OnTheClockProps) {
  'widget';
  // Daylight `palette.dark` (lib/design-tokens/palette.ts). Inlined, not
  // imported — see this module's header for why that is not optional.
  const BG = '#1B151C'; // background
  const FG = '#F1EAF0'; // foreground
  const MUTED = '#B2A4B3'; // mutedForeground
  const APRICOT = '#F2954B'; // highlight
  const OCHRE = '#E0B061'; // warning
  const GREEN = '#6FB98A'; // success

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
  const headline = isReceipt
    ? props.title
    : overdue
      ? props.overdueTitle
      : props.title;

  const dot = (
    <Circle
      modifiers={[frame({ width: 8, height: 8 }), foregroundStyle(accent)]}
    />
  );

  const ring =
    barValue !== null ? (
      <ProgressView
        value={barValue}
        modifiers={[
          progressViewStyle('circular'),
          frame({ width: 16, height: 16 }),
          tint(accent),
        ]}
      />
    ) : (
      dot
    );

  const bar =
    barValue !== null ? (
      <ProgressView
        value={barValue}
        modifiers={[
          progressViewStyle('linear'),
          frame({ height: 4 }),
          tint(accent),
        ]}
      />
    ) : null;

  const figures =
    !isReceipt && !overdue ? (
      <HStack alignment="center" spacing={16}>
        <Text
          modifiers={[
            font({ size: 13, weight: 'medium' }),
            foregroundStyle(FG),
            monospacedDigit(),
          ]}
        >
          {props.clockedInLabel}
        </Text>
        {props.finishLabel ? (
          <Text
            modifiers={[
              font({ size: 13, weight: 'medium' }),
              foregroundStyle(MUTED),
              monospacedDigit(),
            ]}
          >
            {props.finishLabel}
          </Text>
        ) : null}
        <Spacer />
      </HStack>
    ) : null;

  const note = isReceipt
    ? props.detail
    : overdue
      ? props.overdueNote
      : props.unmatchedNote;

  const noteText = note ? (
    <Text
      modifiers={[
        font({ size: 13 }),
        foregroundStyle(overdue && !isReceipt ? OCHRE : MUTED),
        monospacedDigit(),
      ]}
    >
      {note}
    </Text>
  ) : null;

  // Ghost while things are ordinary, filled once overdue — the one moment
  // clocking out is the only thing worth doing (mirrors ClockInCard).
  const clockOutButton = isReceipt ? null : (
    <Link destination={props.clockOutUrl}>
      <Text
        modifiers={[
          font({ size: 15, weight: 'semibold' }),
          foregroundStyle(overdue ? BG : FG),
          // `minHeight`, not `height`: @expo/ui's FrameModifier drops every
          // min/max field the moment a fixed width or height is set, so
          // `{ maxWidth, height }` would silently collapse this to the width
          // of its own label. 10000 stands in for `.infinity`, which cannot
          // survive the JSON hop to native.
          frame({ maxWidth: 10000, minHeight: 44, alignment: 'center' }),
          background(overdue ? OCHRE : '#2E2431'),
          cornerRadius(14),
        ]}
      >
        {props.clockOutLabel}
      </Text>
    </Link>
  );

  const banner = (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[
        padding({ all: 14 }),
        activityBackgroundTint(BG),
        widgetURL(props.bodyUrl),
      ]}
    >
      <HStack alignment="center" spacing={6}>
        {dot}
        <Text
          modifiers={[
            font({ size: 15, weight: 'semibold' }),
            foregroundStyle(isReceipt ? GREEN : overdue ? OCHRE : FG),
            monospacedDigit(),
          ]}
        >
          {headline}
        </Text>
        <Spacer />
      </HStack>
      {isReceipt ? null : (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(MUTED)]}>
          {props.household}
        </Text>
      )}
      {figures}
      {noteText}
      {bar}
      {clockOutButton}
    </VStack>
  );

  return {
    banner,
    minimal: ring,
    compactLeading: dot,
    compactTrailing: ring,
    expandedLeading: (
      <HStack alignment="center" spacing={6}>
        {dot}
        <Text
          modifiers={[
            font({ size: 13, weight: 'semibold' }),
            foregroundStyle(isReceipt ? GREEN : overdue ? OCHRE : FG),
          ]}
        >
          {headline}
        </Text>
      </HStack>
    ),
    expandedTrailing: isReceipt ? null : (
      <Text
        modifiers={[
          font({ size: 13 }),
          foregroundStyle(MUTED),
          monospacedDigit(),
        ]}
      >
        {props.finishLabel ?? props.clockedInLabel}
      </Text>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={8}>
        {noteText}
        {bar}
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

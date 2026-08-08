/**
 * @module domains/today/__tests__/ClockOutSheet
 *
 * D20 — break minutes/note were never collected at clock-out, so every
 * genuine unpaid break was recorded as worked time. This sheet is the fix.
 * Pattern B (mock rendering, docs/09-TESTING.md §5): a pure, prop-driven
 * component, so no QueryClientProvider needed — just the preload mocks.
 *
 * Covers: defaults to "no break" so confirming with zero taps on the break
 * picker still submits correctly (the "fast to skip" requirement); a quick
 * chip sets the break value; a typed custom value overrides the chips; the
 * note is trimmed; and the submitted payload is exactly what was entered.
 *
 * Daylight audit P0-2 — also covers the summary block (`In`/`Out`/`Break`/
 * total) that used to be entirely missing: it must recompute live as the
 * break changes, use the zone-aware `formatClockTime` (not `getHours()`),
 * and match the server's `computeWorkedMinutes` rule exactly, including the
 * break-longer-than-elapsed case (clamped to 0, not negative or an error).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { fireEvent, render } from '@testing-library/react-native';
import type * as React from 'react';
import { ClockOutSheet } from '../components/ClockOutSheet';

const sheetSourcePath = join(__dirname, '../components/ClockOutSheet.tsx');

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

const CLOCK_IN_AT = '2026-08-02T08:15:00.000Z';
/**
 * An EVENING start, for the overnight-roll cases. The 08:15 default cannot
 * express a legitimate overnight: the roll produces `24h - (start - finish)`,
 * so any finish rolled off an 08:15 start is at least 16h — at or over the
 * server's `MAX_SESSION_SPAN_MS` ceiling. These fixtures used to submit an
 * 18-hour shift and assert it was fine; the server would always have
 * refused it with `CLOCK_SPAN_TOO_LONG`.
 */
const EVENING_CLOCK_IN_AT = '2026-08-01T20:00:00.000Z';
const TIME_ZONE = 'UTC';
const NOW_MS = new Date('2026-08-02T17:29:00.000Z').getTime();

function renderSheet(
  overrides: Partial<React.ComponentProps<typeof ClockOutSheet>> = {}
) {
  const onSubmit = mock();
  const utils = render(
    <ClockOutSheet
      visible
      onDismiss={() => {}}
      onSubmit={onSubmit}
      isSubmitting={false}
      clockInAt={CLOCK_IN_AT}
      timeZone={TIME_ZONE}
      nowMs={NOW_MS}
      {...overrides}
    />
  );
  return { ...utils, onSubmit };
}

describe('ClockOutSheet', () => {
  it('confirming immediately (no interaction) submits no break and no note', () => {
    const { getByTestId, onSubmit } = renderSheet();

    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({ breakMinutes: 0, note: '' });
  });

  it('a quick-pick chip sets the break minutes submitted', () => {
    const { getByTestId, onSubmit } = renderSheet();

    fireEvent.press(getByTestId('clockout-break-30'));
    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({ breakMinutes: 30, note: '' });
  });

  it('a typed custom break value overrides the chips', () => {
    const { getByTestId, onSubmit } = renderSheet();

    fireEvent.press(getByTestId('clockout-break-30'));
    fireEvent.changeText(getByTestId('clockout-break-custom'), '20');
    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({ breakMinutes: 20, note: '' });
  });

  it('an invalid custom break value falls back to zero rather than NaN', () => {
    const { getByTestId, onSubmit } = renderSheet();

    fireEvent.changeText(getByTestId('clockout-break-custom'), 'abc');
    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({ breakMinutes: 0, note: '' });
  });

  it('submits a trimmed note alongside the break minutes', () => {
    const { getByTestId, onSubmit } = renderSheet();

    fireEvent.press(getByTestId('clockout-break-15'));
    fireEvent.changeText(getByTestId('clockout-note'), '  covered pickup  ');
    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({
      breakMinutes: 15,
      note: 'covered pickup',
    });
  });

  // NOTE on the summary block's translated "In {{in}} · Out {{out}} · Break
  // {{breakMinutes}}m ·" text: `bun.setup.ts`'s KEY-ECHO i18n mock
  // (`t: (key) => key`, params dropped) makes the interpolated copy
  // unobservable in a render test by design — "assert on stable keys, not
  // copy". So `clockout-summary-prefix` is only checked against the echoed
  // key here; the TOTAL (`clockout-summary-total`) is real, untranslated
  // text (`formatDuration` output, never routed through `t()`), so it's
  // asserted on directly — that's what actually proves the live-recompute
  // and clamp-to-0 behavior. The zone-aware wiring of the "in"/"out" times
  // themselves is proven at the wiring level below (source inspection) and
  // exhaustively at the unit level in duration.test.ts's formatClockTime
  // coverage.
  describe('summary block (P0-2)', () => {
    it('renders the summary (translated prefix key + real total) when there is a clock-in instant', () => {
      const { getByTestId } = renderSheet();

      expect(getByTestId('clockout-summary')).toBeTruthy();
      expect(getByTestId('clockout-summary-prefix').props.children).toBe(
        'clockOutSummaryPrefix'
      );
      // 08:15 -> 17:29 is 9h14m; no break selected yet (defaults to 0).
      expect(getByTestId('clockout-summary-total').props.children).toBe(
        '9h 14m'
      );
    });

    it('recomputes the total live when a quick-pick break is selected', () => {
      const { getByTestId } = renderSheet();

      fireEvent.press(getByTestId('clockout-break-30'));

      // 9h14m (554m) minus a 30 minute break = 524m = 8h44m.
      expect(getByTestId('clockout-summary-total').props.children).toBe(
        '8h 44m'
      );
    });

    it('recomputes the total live when a custom break value is typed', () => {
      const { getByTestId } = renderSheet();

      fireEvent.changeText(getByTestId('clockout-break-custom'), '44');

      // 554m - 44m = 510m = 8h30m.
      expect(getByTestId('clockout-summary-total').props.children).toBe(
        '8h 30m'
      );
    });

    it('clamps the total to 0m when the break exceeds the elapsed time, never negative — mirrors the server clamp', () => {
      // Only 5 minutes have elapsed; a 60 minute break must not go negative.
      const { getByTestId } = renderSheet({
        nowMs: new Date('2026-08-02T08:20:00.000Z').getTime(),
      });

      fireEvent.press(getByTestId('clockout-break-60'));

      expect(getByTestId('clockout-summary-total').props.children).toBe('0m');
    });

    it('reads a same-minute finish as 0m, not a 24-hour shift', () => {
      // The finish field rolls an end at or before the start onto the next
      // day so an overnight session works. Typing the START time back is the
      // one case that is not overnight — it is a zero-length session, and
      // 24h is not even submittable (the server caps a session at 16h).
      const { getByTestId } = renderSheet();

      fireEvent.changeText(getByTestId('clockout-finish-time'), '08:15');

      expect(getByTestId('clockout-summary-total').props.children).toBe('0m');
    });

    it('still rolls a genuinely earlier finish onto the next day (overnight)', () => {
      const { getByTestId } = renderSheet();

      fireEvent.changeText(getByTestId('clockout-finish-time'), '02:15');

      // 08:15 -> 02:15 the following morning is 18 hours.
      expect(getByTestId('clockout-summary-total').props.children).toBe('18h');
    });

    it('omits the summary entirely when there is no clock-in instant (data anomaly)', () => {
      const { queryByTestId } = renderSheet({ clockInAt: null });

      expect(queryByTestId('clockout-summary')).toBeNull();
    });
  });

  describe('zero-length clock-out (Daylight audit — block at submit, not just at the server)', () => {
    it('blocks the submit and shows an inline message when the finish time equals the start time', () => {
      const { getByTestId, onSubmit } = renderSheet();

      fireEvent.changeText(getByTestId('clockout-finish-time'), '08:15');
      fireEvent.press(getByTestId('clockout-confirm'));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(getByTestId('clockout-zero-length-error').props.children).toBe(
        'zeroLengthFinishError'
      );
    });

    it('still submits the ordinary overnight case (finish before start by wall clock, rolls to next day)', () => {
      const { getByTestId, onSubmit } = renderSheet({
        clockInAt: EVENING_CLOCK_IN_AT,
      });

      fireEvent.changeText(getByTestId('clockout-finish-time'), '02:15');
      fireEvent.press(getByTestId('clockout-confirm'));

      expect(onSubmit).toHaveBeenCalled();
    });
  });

  describe("future clock-out (Daylight audit — block at submit, matching the server's CLOCK_OUT_IN_FUTURE)", () => {
    // Household time 00:32, clock-in at 00:15 the same day: typing a finish
    // of 01:45 is a plain same-day mistake (01:45 is after the 00:15 start,
    // so this is NOT the overnight-roll case) and lands over an hour after
    // "now" — exactly the report's on-device reproduction.
    const RECENT_CLOCK_IN_AT = '2026-08-02T00:15:00.000Z';
    const HOUSEHOLD_NOW_MS = new Date('2026-08-02T00:32:00.000Z').getTime();

    it('blocks the submit and shows an inline message when the finish resolves to after now', () => {
      const { getByTestId, onSubmit } = renderSheet({
        clockInAt: RECENT_CLOCK_IN_AT,
        nowMs: HOUSEHOLD_NOW_MS,
      });

      fireEvent.changeText(getByTestId('clockout-finish-time'), '01:45');

      expect(getByTestId('clockout-future-finish-error').props.children).toBe(
        'futureFinishError'
      );

      fireEvent.press(getByTestId('clockout-confirm'));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('allows a finish exactly at now, and within the 60s tolerance the server also applies', () => {
      const { getByTestId, queryByTestId, onSubmit } = renderSheet({
        clockInAt: RECENT_CLOCK_IN_AT,
        nowMs: HOUSEHOLD_NOW_MS, // 00:32:00.000 exactly
      });

      // 00:33 is exactly 60s after "now" — the server's own boundary
      // (`outMs > Date.now() + CLOCK_SKEW_TOLERANCE_MS`) is strict, so equal
      // to the tolerance is still allowed.
      fireEvent.changeText(getByTestId('clockout-finish-time'), '00:33');

      expect(queryByTestId('clockout-future-finish-error')).toBeNull();
      fireEvent.press(getByTestId('clockout-confirm'));
      expect(onSubmit).toHaveBeenCalled();
    });

    it('blocks one minute past the tolerance boundary', () => {
      const { getByTestId, onSubmit } = renderSheet({
        clockInAt: RECENT_CLOCK_IN_AT,
        nowMs: HOUSEHOLD_NOW_MS,
      });

      fireEvent.changeText(getByTestId('clockout-finish-time'), '00:34');

      expect(getByTestId('clockout-future-finish-error')).toBeTruthy();
      fireEvent.press(getByTestId('clockout-confirm'));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("does NOT flag the overnight roll as a future finish, even though the rolled instant lands after this test's nowMs", () => {
      // Same fixture as the "still rolls a genuinely earlier finish onto the
      // next day" test above: finish (02:15) is before the start (20:00) by
      // wall clock, so it legitimately rolls to the next calendar day. A
      // naive "is the resolved instant after now" check would misfire here
      // — this is the exact regression the zero-length fix already had to
      // avoid, and this fix must avoid it too.
      const { getByTestId, queryByTestId, onSubmit } = renderSheet({
        clockInAt: EVENING_CLOCK_IN_AT,
      });

      fireEvent.changeText(getByTestId('clockout-finish-time'), '02:15');

      expect(queryByTestId('clockout-future-finish-error')).toBeNull();
      fireEvent.press(getByTestId('clockout-confirm'));
      expect(onSubmit).toHaveBeenCalled();
    });

    it('does not clash with the zero-length message when both start and finish are typed equal', () => {
      const { getByTestId, queryByTestId } = renderSheet({
        clockInAt: RECENT_CLOCK_IN_AT,
        nowMs: HOUSEHOLD_NOW_MS,
      });

      fireEvent.changeText(getByTestId('clockout-finish-time'), '00:15');

      expect(getByTestId('clockout-zero-length-error')).toBeTruthy();
      expect(queryByTestId('clockout-future-finish-error')).toBeNull();
    });
  });

  describe('summary block wiring (source inspection — proves zone-awareness independent of the key-echo i18n mock)', () => {
    let sheetSource: string;

    beforeAll(async () => {
      sheetSource = await Bun.file(sheetSourcePath).text();
    });

    it('formats "in" and "out" through the zone-aware formatClockTime(iso, timeZone), never getHours()', () => {
      // Both arguments now come from `effectiveClockInAt` /
      // `effectiveClockOutMs` — the instants the typed times resolve to —
      // rather than the raw props, since #7/P0-2 made the finish editable.
      // The property under test is unchanged: every label goes through the
      // zone-aware formatter with `timeZone`, and nothing reads the device
      // clock's `getHours()`.
      expect(sheetSource).toMatch(
        /formatClockTime\(\s*effectiveClockInAt \?\? clockInAt,\s*timeZone\s*\)/
      );
      expect(sheetSource).toMatch(
        /formatClockTime\(\s*new Date\(effectiveClockOutMs\)\.toISOString\(\),\s*timeZone\s*\)/
      );
      expect(sheetSource).not.toMatch(/\.getHours\(\)/);
    });

    it('computes the total with computeWorkedMinutesFromInstants — the mirror of the server rule', () => {
      expect(sheetSource).toMatch(
        /computeWorkedMinutesFromInstants\(\s*effectiveClockInAt,\s*effectiveClockOutMs,\s*breakMinutes\s*\)/
      );
    });

    it('resolves the typed wall clocks in the HOUSEHOLD zone, and rolls an overnight finish onto the next day', () => {
      // Reuses `shiftInstantsFromWallClock` rather than reimplementing the
      // conversion — it already handles a finish at or before the start,
      // which is exactly the overnight shift a carer is most likely to have
      // forgotten to clock out of.
      expect(sheetSource).toContain('shiftInstantsFromWallClock(');
      expect(sheetSource).toContain(
        'localDateInZone(timeZone, new Date(clockInAt))'
      );
    });
  });

  describe('custom break input (Daylight audit craft findings)', () => {
    it('has a visible label, not just an accessibilityLabel', () => {
      const { getByText } = renderSheet();

      // Key-echo mock (see note above) — the echoed key IS the visible
      // text, proving a real text node renders here (not just a prop).
      expect(getByText('customBreakLabel')).toBeTruthy();
    });

    it('shows a minutes unit next to the field', () => {
      const { getByText } = renderSheet();

      expect(getByText('minutesUnit')).toBeTruthy();
    });
  });

  describe('session-span ceiling (the reported CLOCK_SPAN_TOO_LONG 400)', () => {
    // The bug as reported: an 06:53 start, a finish typed as 05:27, and a
    // PATCH carrying 2026-08-05T05:27Z against a 2026-08-04T06:53Z start —
    // 22h 34m, refused by the server, with nothing shown to the carer. The
    // roll to the next day is what produced it, and it was invisible.
    const REPORTED_CLOCK_IN_AT = '2026-08-04T06:53:37.958Z';
    const REPORTED_NOW_MS = new Date('2026-08-04T18:00:00.000Z').getTime();

    it('blocks the submit and names the span when a finish rolls past the 16h ceiling', () => {
      const { getByTestId, onSubmit } = renderSheet({
        clockInAt: REPORTED_CLOCK_IN_AT,
        nowMs: REPORTED_NOW_MS,
      });

      fireEvent.changeText(getByTestId('clockout-finish-time'), '05:27');
      fireEvent.press(getByTestId('clockout-confirm'));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(getByTestId('clockout-too-long-error').props.children).toBe(
        'tooLongFinishError'
      );
    });

    it('does not show the overnight hint for a roll it is refusing anyway', () => {
      const { getByTestId, queryByTestId } = renderSheet({
        clockInAt: REPORTED_CLOCK_IN_AT,
        nowMs: REPORTED_NOW_MS,
      });

      fireEvent.changeText(getByTestId('clockout-finish-time'), '05:27');

      expect(queryByTestId('clockout-overnight-hint')).toBeNull();
    });

    it('leaves a legitimate overnight alone and says which day it finishes', () => {
      const { getByTestId, queryByTestId, onSubmit } = renderSheet({
        clockInAt: EVENING_CLOCK_IN_AT,
      });

      fireEvent.changeText(getByTestId('clockout-finish-time'), '02:15');

      expect(queryByTestId('clockout-too-long-error')).toBeNull();
      expect(getByTestId('clockout-overnight-hint').props.children).toBe(
        'overnightFinishHint'
      );
      fireEvent.press(getByTestId('clockout-confirm'));
      expect(onSubmit).toHaveBeenCalled();
    });

    it('shows no overnight hint for an ordinary same-day finish', () => {
      const { getByTestId, queryByTestId } = renderSheet();

      fireEvent.changeText(getByTestId('clockout-finish-time'), '16:30');

      expect(queryByTestId('clockout-overnight-hint')).toBeNull();
    });
  });

  describe('server refusals render inside the sheet, not as a toast a presented modal hides', () => {
    it('renders submitError inline', () => {
      const { getByTestId } = renderSheet({
        submitError: 'That clashes with 4 Aug (09:00-17:00).',
      });

      expect(getByTestId('clockout-submit-error').props.children).toBe(
        'That clashes with 4 Aug (09:00-17:00).'
      );
    });

    it('renders no error block when there is no refusal', () => {
      const { queryByTestId } = renderSheet();

      expect(queryByTestId('clockout-submit-error')).toBeNull();
      expect(queryByTestId('clockout-submit-error-action')).toBeNull();
    });

    it('renders the optional action and fires it', () => {
      const onPress = mock();
      const { getByTestId } = renderSheet({
        submitError: 'That clashes with an entry you already have.',
        submitErrorAction: { label: 'Open that entry', onPress },
      });

      fireEvent.press(getByTestId('clockout-submit-error-action'));

      expect(onPress).toHaveBeenCalled();
    });

    it('shows the action only alongside a refusal', () => {
      const { queryByTestId } = renderSheet({
        submitErrorAction: { label: 'Open that entry', onPress: mock() },
      });

      expect(queryByTestId('clockout-submit-error-action')).toBeNull();
    });
  });

  describe('edit mode leaves an untouched finish alone (it used to round it)', () => {
    const RECORDED_CLOCK_OUT_AT = '2026-08-02T16:42:37.412Z';

    it('shows the recorded finish without arming it for submit', () => {
      const { getByTestId, onSubmit } = renderSheet({
        mode: 'edit',
        defaultClockOutAt: RECORDED_CLOCK_OUT_AT,
      });

      expect(getByTestId('clockout-finish-time').props.value).toBe('16:42');

      fireEvent.press(getByTestId('clockout-break-30'));
      fireEvent.press(getByTestId('clockout-confirm'));

      // No `clockOutAt`: rebuilding it from HH:MM would silently drop the
      // recorded 37.412 seconds on a break-only correction.
      expect(onSubmit).toHaveBeenCalledWith({ breakMinutes: 30, note: '' });
    });

    it('sends the finish once the carer actually retypes it', () => {
      const { getByTestId, onSubmit } = renderSheet({
        mode: 'edit',
        defaultClockOutAt: RECORDED_CLOCK_OUT_AT,
      });

      fireEvent.changeText(getByTestId('clockout-finish-time'), '16:30');
      fireEvent.press(getByTestId('clockout-confirm'));

      expect(onSubmit).toHaveBeenCalledWith({
        breakMinutes: 0,
        note: '',
        clockOutAt: '2026-08-02T16:30:00.000Z',
      });
    });

    it('clockOut mode still arms a pre-filled scheduled finish (forgotten clock-out)', () => {
      const { getByTestId, onSubmit } = renderSheet({
        defaultClockOutAt: '2026-08-02T17:00:00.000Z',
      });

      fireEvent.press(getByTestId('clockout-confirm'));

      expect(onSubmit).toHaveBeenCalledWith({
        breakMinutes: 0,
        note: '',
        clockOutAt: '2026-08-02T17:00:00.000Z',
      });
    });
  });

  describe('break chip touch target (Daylight audit #39)', () => {
    let sheetSource: string;

    beforeAll(async () => {
      sheetSource = await Bun.file(sheetSourcePath).text();
    });

    it('quick-pick break chips use the default (>=44pt) size, not size="sm" (36px)', () => {
      const chipBlockMatch = sheetSource.match(
        /testID=\{`clockout-break-\$\{minutes\}`\}[\s\S]{0,600}?onPress=\{\(\) => selectQuickBreak/
      );
      expect(chipBlockMatch).toBeTruthy();
      const chipBlock = chipBlockMatch?.[0] ?? '';
      expect(chipBlock).not.toMatch(/\bsize="sm"/);
      expect(chipBlock).toMatch(/\bsize="default"/);
    });
  });
});

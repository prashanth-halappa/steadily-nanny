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

    it('omits the summary entirely when there is no clock-in instant (data anomaly)', () => {
      const { queryByTestId } = renderSheet({ clockInAt: null });

      expect(queryByTestId('clockout-summary')).toBeNull();
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

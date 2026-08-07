/**
 * @module testVectors/minuteVectors
 *
 * Pins I-11: apps/api and apps/mobile each compute "minutes worked" from a
 * clock-in/clock-out span with their own hand-written formula (no shared
 * runtime — mobile can't import server code), and until now nothing forced
 * the two to agree beyond prose comments pointing at each other. This file is
 * the one shared fixture both sides iterate so a drift shows up as a red test
 * on BOTH suites, not a silent mismatch discovered in production.
 *
 * Consumers:
 * - apps/api/tests/unit/domains/timesheet/utils/workedMinutes.test.ts
 *   (`computeWorkedMinutes`, `entryMinutes`)
 * - apps/mobile/src/domains/timesheet/__tests__/entryMinutes.test.ts
 *   (`computeWorkedMinutesFromInstants`, `computeEntryMinutes`)
 *
 * ROUNDING ORDER NOTE: the API rounds the whole span first, then subtracts
 * the break (`Math.round(spanMs / 60_000) - breakMinutes`). Mobile subtracts
 * the break first, then rounds (`Math.round(spanMs / 60_000 - breakMinutes)`).
 * `round(a) - b === round(a - b)` only when `b` is an integer, which
 * `break_minutes` always is in practice — MINUTE_VECTORS uses only integer
 * `break_minutes` so both formulas are expected to agree on every vector
 * here. If a future vector needs a fractional break, it will expose the
 * formulas as genuinely different rules, not a shared one.
 *
 * SCOPE: per-entry parity only, deliberately. The aggregation layer
 * (`sumWorkedMinutes` / `sumEntryMinutes`) is NOT vector-covered — the two
 * sides diverge there by design (a running entry sums as 0 on the API and as
 * live elapsed time on mobile), so a shared sum vector cannot exist for the
 * running case; the finished-entry sums are plain additions over the values
 * pinned here.
 */

export interface MinuteVector {
  readonly name: string;
  readonly clock_in_at: string;
  readonly clock_out_at: string;
  readonly break_minutes: number;
  readonly expected: number;
}

export const MINUTE_VECTORS: readonly MinuteVector[] = [
  {
    name: 'whole_hours_with_break',
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T16:00:00.000Z',
    break_minutes: 30,
    expected: 450,
  },
  {
    name: 'zero_break',
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T08:45:00.000Z',
    break_minutes: 0,
    expected: 45,
  },
  {
    name: 'real_seconds_round_up_31s',
    // 1h0m31s = 60.51666...min -> rounds up to 61.
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T09:00:31.000Z',
    break_minutes: 0,
    expected: 61,
  },
  {
    name: 'real_seconds_round_down_29s',
    // 1h0m29s = 60.48333...min -> rounds down to 60.
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T09:00:29.000Z',
    break_minutes: 0,
    expected: 60,
  },
  {
    name: 'half_minute_tie_rounds_up',
    // Exactly 60.5 minutes. Math.round ties round toward +Infinity.
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T09:00:30.000Z',
    break_minutes: 0,
    expected: 61,
  },
  {
    name: 'break_larger_than_span_clamps_to_zero',
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T08:10:00.000Z',
    break_minutes: 60,
    expected: 0,
  },
  {
    name: 'break_equal_to_span_is_zero',
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T09:00:00.000Z',
    break_minutes: 60,
    expected: 0,
  },
  {
    name: 'large_span_near_16h_cap',
    clock_in_at: '2026-08-03T06:00:00.000Z',
    clock_out_at: '2026-08-03T22:00:00.000Z',
    break_minutes: 30,
    expected: 930,
  },
  {
    name: 'sub_minute_span_rounds_up_to_one',
    // 45s = 0.75min -> rounds up to 1.
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T08:00:45.000Z',
    break_minutes: 0,
    expected: 1,
  },
  {
    name: 'sub_minute_span_rounds_down_to_zero',
    // 20s = 0.333min -> rounds down to 0.
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T08:00:20.000Z',
    break_minutes: 0,
    expected: 0,
  },
  {
    name: 'iso_offset_style_both_ends',
    clock_in_at: '2026-08-03T08:00:00+00:00',
    clock_out_at: '2026-08-03T16:00:00+00:00',
    break_minutes: 30,
    expected: 450,
  },
  {
    name: 'iso_mixed_offset_and_zulu_style',
    clock_in_at: '2026-08-03T08:00:00+00:00',
    clock_out_at: '2026-08-03T16:00:00.000Z',
    break_minutes: 30,
    expected: 450,
  },
];

export interface CancellationVector {
  readonly name: string;
  readonly scheduled_minutes: number | null;
  readonly clock_in_at: string;
  readonly clock_out_at: string;
  readonly expected: number;
}

export const CANCELLATION_VECTORS: readonly CancellationVector[] = [
  {
    name: 'stored_minutes_authoritative_even_when_span_disagrees',
    // Span rounds to 420; the stored residual (419) is what must be paid.
    scheduled_minutes: 419,
    clock_in_at: '2026-08-03T12:00:40.000Z',
    clock_out_at: '2026-08-03T19:00:20.000Z',
    expected: 419,
  },
  {
    name: 'negative_stored_minutes_clamps_to_zero',
    scheduled_minutes: -30,
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T09:00:00.000Z',
    expected: 0,
  },
  {
    name: 'null_stored_minutes_falls_back_to_span',
    scheduled_minutes: null,
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T15:00:00.000Z',
    expected: 420,
  },
];

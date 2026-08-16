/**
 * The terms document, rendered to strings, server-side (§6.2).
 *
 * WHY THE API RENDERS AND NOT THE CALLER. The public terms page
 * (`nanny.getsteadily.app/t/:code`) is served by a Cloudflare worker, and the
 * proposal review screen is served by the app. §6.2 is explicit that the API
 * returns the RENDERED STRINGS so the worker holds no formatting logic and
 * cannot drift: "the family reads the same contract on the web as in the app"
 * becomes a property of the code rather than a promise in a doc.
 *
 * PURE. No I/O, no repository, no service — `GET /household-invites/:code/
 * terms-preview` is UNAUTHENTICATED, and a renderer that could reach the
 * database from that path is a renderer that could leak more than the code's
 * bearer secret entitles.
 *
 * THE ORDER IS NOT DUPLICATED BY EYE. It mirrors
 * `apps/mobile/src/domains/pay/utils/termRows.ts` — §3's inventory in §4's
 * group order — and `tests/unit/domains/termsProposal/utils/renderTermRows.test.ts`
 * reads that file and the en-US locale to prove the two agree. Two deliberate
 * deltas, both pinned there:
 *
 *   - `ptoBalance` is dropped. It is a live `pto_ledger` figure and a proposal
 *     has no ledger; inventing one would be a fabricated number on the screen
 *     where the contract is signed (T16).
 *   - `Starts` is added, last. `valid_from` is the app card's header, but §7.4
 *     makes the start date the entire reason D-16 gates this feature, and both
 *     the §6.2 and §7.2 mocks close the terms card with it.
 *
 * T16 SURVIVES THE FLATTENING. `RenderedTermRow.value` is a plain non-empty
 * string, so a null underlying value is RESOLVED here rather than passed on:
 * the row is simply absent. T16's two null meanings — "No cancellation pay"
 * as an explicit agreement, and "Not set" as a blank — now collapse to that
 * one outcome; the cancellations row is dropped when its window is null,
 * the same as every other unset term. A fabricated `$0.00` still never
 * appears. The worker needs no change: it prints the rows it is given,
 * verbatim, and a missing row is a row it was never given.
 *
 * NO JURISDICTION IS EVER NAMED (owner decision, §4.1.1). Prefilled values
 * read as common starting points, never as a named state's preset.
 *
 * @module domains/termsProposal/utils/renderTermRows
 */
import type { CreatePayArrangementRequest } from '../../pay/types';

/** One label/value pair, both already rendered. The worker prints them as-is. */
export interface RenderedTermRow {
  label: string;
  value: string;
}

/**
 * The hero, which is NOT a labelled row on any surface — §6.2 and §7.2 both
 * show the rate as a large figure with the weekly line beneath it and no
 * label at all. It is a separate return type rather than `rows[0]` because a
 * positional contract hiding inside `RenderedTermRow[]` is one nothing in the
 * type system stops a consumer from rendering as an ordinary row, which would
 * put the invented label "Hourly rate" on the public page.
 */
export interface RenderedTermsHeader {
  rate: string;
  /**
   * Null when there is no rate, no guarantee, or no server-computed weekly
   * figure — the caller renders NOTHING rather than a figure we cannot stand
   * behind (T16, §7.2).
   */
  weeklyLine: string | null;
}

/** The documentary fields "In writing" counts against (`termRows.ts`). */
const IN_WRITING_FIELD_COUNT = 5;

/**
 * Integer minor units to an en-US currency string. `Intl` does the work — the
 * division by 100 is the only arithmetic, and it happens once, here, exactly
 * as `apps/mobile/src/lib/money.ts` does it (that module cannot be imported
 * across apps: it reads the device locale at import time).
 *
 * The catch is not defensive dressing. `Intl.NumberFormat` throws a
 * `RangeError` on a malformed currency code, and `terms` is an opaque jsonb
 * bag that predates today's `CurrencyCodeSchema` — a throw here would 500 a
 * PUBLIC page instead of showing a family their terms.
 */
function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

/** Minutes to the app's bare hour figure — "40", "7.5", never "40.0". */
function hours(minutes: number): string {
  return trimZeros(minutes / 60);
}

/** "1.5" stays 1.5; 2 becomes "2", not "2.0" — `termRows.ts`'s own rule. */
function trimZeros(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * "Monday Aug 17" — the mock's form, weekday and month/day, no year and no
 * comma. Parsed as UTC midnight so a `YYYY-MM-DD` never slides a day backward
 * on a server west of Greenwich, which would print the wrong start date on the
 * one row the whole D-16 dependency exists for.
 */
function startDate(iso: string): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
  return formatted.replace(',', '');
}

/** §4's pay-schedule words. `null` for an unstated schedule, never a guess. */
function paySchedule(frequency: string | null | undefined): string | null {
  switch (frequency) {
    case 'weekly':
      return 'Weekly';
    case 'biweekly':
      return 'Every two weeks';
    case 'semimonthly':
      return 'Twice a month';
    case 'monthly':
      return 'Monthly';
    default:
      return null;
  }
}

/**
 * D-13's recurring stipends, out of the `terms` jsonb. Every read NARROWS
 * rather than coerces, the same discipline `termRows.ts` uses: a hand-edited
 * row of the wrong shape is DROPPED, never rendered as a term somebody agreed
 * to.
 */
function stipendLine(row: unknown, currency: string): string | null {
  if (typeof row !== 'object' || row === null) return null;
  const { label, amount_minor, cadence } = row as Record<string, unknown>;
  if (typeof label !== 'string' || typeof amount_minor !== 'number') {
    return null;
  }
  // LABEL FIRST, then the amount — `terms.outsideWagesItem*` in
  // `en/pay.json`, which is the app's live wording. §6.2's mock reads
  // "$200 a month health stipend" and the app reads "health stipend $200.00 a
  // month"; the locale wins, because the promise is that the web page says
  // what the app says, not what a sketch in the spec said.
  const amount = money(amount_minor, currency);
  switch (cadence) {
    case 'monthly':
      return `${label} ${amount} a month`;
    case 'annual':
      return `${label} ${amount} a year`;
    default:
      return `${label} ${amount} a week`;
  }
}

function outsideWages(
  bag: Record<string, unknown> | undefined,
  currency: string
): string | null {
  const recurring = bag?.recurring;
  if (!Array.isArray(recurring)) return null;
  const lines = recurring
    .map(row => stipendLine(row, currency))
    .filter((line): line is string => line !== null);
  return lines.length === 0 ? null : lines.join(' · ');
}

/**
 * T9's documentary fields, as a COUNT only. §6.2 keeps this block collapsed on
 * the public page: the fields are long-form prose and expanding them would
 * push the primary button below the fold on a phone, which is the one thing
 * that page cannot afford.
 *
 * THE EXPANDABLE BODY IS DEFERRED, NOT DECLINED. §6.2 does want the fields
 * readable once expanded; the web page is D-37's fast-follow and did not ship
 * in 3-O, so a second field carrying the detail lines would have been built
 * against no consumer. Add it here when the page lands — the count was never
 * meant to be the whole intent.
 */
function inWritingCount(bag: Record<string, unknown> | undefined): number {
  let filled = 0;
  if (typeof bag?.notice_period_days === 'number') filled++;
  if (typeof bag?.probation_days === 'number') filled++;
  for (const field of ['duties', 'driving', 'live_in'] as const) {
    const text = bag?.[field];
    if (typeof text === 'string' && text.trim() !== '') filled++;
  }
  return filled;
}

/**
 * The hero figures. Separate from the rows on purpose — see
 * `RenderedTermsHeader`.
 *
 * `weeklyEquivalentMinor` is the SERVER-COMPUTED figure from
 * `earningsService.weeklyEquivalentMinor` — never `rate x hours` (§17, D23).
 * At $28.00/hr with overtime after 40h, 50 guaranteed hours is $1,540.00; a
 * naive multiply prints $1,400.00 on the screen where the contract is agreed.
 * Pass `null` and the weekly line is omitted rather than approximated.
 */
export function renderTermsHeader(
  terms: CreatePayArrangementRequest,
  weeklyEquivalentMinor: number | null,
  currency: string
): RenderedTermsHeader {
  const ccy = terms.currency ?? currency;
  const guarantee = terms.guaranteed_minutes_per_week;
  return {
    rate: money(terms.rate_minor, ccy),
    weeklyLine:
      terms.rate_minor && weeklyEquivalentMinor !== null && guarantee
        ? `${money(weeklyEquivalentMinor, ccy)} a week at ${hours(guarantee)} guaranteed hours`
        : null,
  };
}

/**
 * The terms document as label/value pairs — the card body only. The rate and
 * the weekly line are `renderTermsHeader`'s.
 *
 * `currency` is the household's; an explicit `terms.currency` still wins, the
 * same resolution `payArrangementCommandService.create` makes, so what the
 * page shows is what the arrangement would be written in.
 *
 * There is no `weeklyEquivalentMinor` parameter: the weekly figure lands on
 * `renderTermsHeader` and nothing here reads it.
 */
export function renderTermRows(
  terms: CreatePayArrangementRequest,
  currency: string
): RenderedTermRow[] {
  const ccy = terms.currency ?? currency;
  const bag = terms.terms;
  const guarantee = terms.guaranteed_minutes_per_week;

  const rows: [string, string | null][] = [
    [
      'Overtime',
      terms.overtime_threshold_minutes == null
        ? null
        : `After ${hours(terms.overtime_threshold_minutes)}h, at ${trimZeros(terms.overtime_multiplier)}×`,
    ],
    [
      'Daily overtime',
      terms.overtime_daily_threshold_minutes == null
        ? null
        : // Reuses the WEEKLY multiplier by design — the daily tier has no
          // multiplier column of its own (§3), same as `termRows.ts`.
          `After ${hours(terms.overtime_daily_threshold_minutes)}h in a day, at ${trimZeros(terms.overtime_multiplier)}×`,
    ],
    [
      'Double time',
      terms.doubletime_daily_threshold_minutes == null ||
      terms.doubletime_multiplier == null
        ? null
        : `After ${hours(terms.doubletime_daily_threshold_minutes)}h in a day, at ${trimZeros(terms.doubletime_multiplier)}×`,
    ],
    ['Seventh consecutive day', seventhDay(terms)],
    [
      'Guaranteed hours',
      guarantee == null ? null : `${hours(guarantee)}h a week`,
    ],
    [
      'Paid time off',
      terms.pto_entitlement_minutes_per_year == null
        ? null
        : `${hours(terms.pto_entitlement_minutes_per_year)}h a year`,
    ],
    [
      'Worked-holiday premium',
      terms.worked_holiday_multiplier == null
        ? null
        : `${trimZeros(terms.worked_holiday_multiplier)}× when worked`,
    ],
    [
      // 3-E5 / §5 D-53 — the holidays group's other half. Same position as
      // `termRows.ts`'s `paidHolidayHours` row; the order-agreement test
      // derives this sequence from that file, so the two can only move
      // together.
      'Unworked holidays',
      terms.holiday_hours_minutes == null
        ? null
        : `${hours(terms.holiday_hours_minutes)}h paid`,
    ],
    [
      'Cancellations',
      terms.cancellation_paid_within_hours == null
        ? null
        : `Paid if within ${terms.cancellation_paid_within_hours}h of the start`,
    ],
    [
      'Mileage',
      terms.mileage_rate_per_mile_minor == null
        ? null
        : `${money(terms.mileage_rate_per_mile_minor, ccy)} a mile`,
    ],
    ['Pay schedule', paySchedule(terms.pay_frequency)],
    ['Outside wages', outsideWages(bag, ccy)],
    ['In writing', inWriting(bag)],
    ['Starts', startDate(terms.valid_from)],
  ];

  return rows
    .filter((row): row is [string, string] => row[1] !== null)
    .map(([label, value]) => ({ label, value }));
}

/** 078's seventh-day rule: one tier, or two. */
function seventhDay(terms: CreatePayArrangementRequest): string | null {
  const multiplier = terms.seventh_day_multiplier;
  if (multiplier == null) return null;
  const after = terms.seventh_day_doubletime_after_minutes;
  const doubletime = terms.doubletime_multiplier;
  if (after == null || doubletime == null) {
    return `At ${trimZeros(multiplier)}×`;
  }
  return `At ${trimZeros(multiplier)}×, then ${trimZeros(doubletime)}× after ${hours(after)}h`;
}

function inWriting(bag: Record<string, unknown> | undefined): string | null {
  const filled = inWritingCount(bag);
  return filled === 0
    ? null
    : `${filled} of ${IN_WRITING_FIELD_COUNT} filled in`;
}

/**
 * @module domains/pay/utils/payArrangementForm
 *
 * Pure date/number helpers + the one function that turns typed form state
 * into a `CreatePayArrangementRequest` (or `null` when anything is invalid).
 * Kept dependency-free from React (the `i18n` singleton import is not React
 * and carries no component lifecycle) so it is exhaustively unit-testable
 * (docs/TIER0-CX-SPEC.md §1's money discipline: "never Math.round(x * 100)
 * on a float without the string path" applies just as much to dates here —
 * every date is a nominal "yyyy-mm-dd" string, resolved with an explicit
 * y/m/d `Date` constructor call, never `new Date(isoString)` parsing, which
 * would shift a calendar date across a UTC/local boundary).
 *
 * `PayChangeSheet` and `PaySetupScreen` both build their submit payload
 * through `buildCreatePayArrangementRequest` — the ONE place the "no future
 * dates" rule and the numeric-field parsing are enforced client-side (the
 * command service enforces them again, server-side, per TIER0-PLAN.md owner
 * decision 4 — this is a fast-fail UX check, not the source of truth).
 */
import type {
  CreatePayArrangementRequest,
  PayFrequency,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import i18n from '@/src/i18n';
import { addLocalDays } from '@/src/lib/localDate';
import { formatMoney, parseMajorToMinor } from '@/src/lib/money';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A local (non-UTC-shifting) `Date` for a nominal "yyyy-mm-dd" string. */
function toLocalDate(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** True only for a real calendar date in strict "yyyy-mm-dd" form — rejects
 * things like "2026-02-30" that `Date` would otherwise silently roll over. */
export function isValidCalendarDate(dateISO: string): boolean {
  if (!ISO_DATE_RE.test(dateISO)) return false;
  const [y, m, d] = dateISO.split('-').map(Number);
  const date = toLocalDate(dateISO);
  return (
    date.getFullYear() === y &&
    date.getMonth() === (m ?? 1) - 1 &&
    date.getDate() === d
  );
}

/**
 * True when `dateISO` is the first day of the HOUSEHOLD's week
 * (`households.week_starts_on`, 0=Sunday..6=Saturday) — the inverse of the
 * mid-week-consequence trigger (TIER0-CX-SPEC.md §2's "Mid-week consequence
 * line"). Not a Monday literal: for a Sunday-start household a Monday
 * change splits the week and a Sunday one doesn't, exactly inverted.
 */
export function isWeekStartDay(dateISO: string, weekStartsOn: number): boolean {
  if (!isValidCalendarDate(dateISO)) return false;
  return toLocalDate(dateISO).getDay() === weekStartsOn;
}

/**
 * "Thursday, September 3" (en-US) — no year — for the mid-week consequence
 * line; the "Today (Aug 4)" chip is handled separately (needs no year, no
 * weekday, `formatShortDate` below).
 *
 * §2.6 / D-4 — was a hand-rolled `WEEKDAYS_LONG`/`MONTHS_LONG` array pair
 * (en-GB day-before-month order, "Thursday 3 September"). `Intl`, keyed off
 * `i18n.language` (the app's own language setting, not the device's — same
 * reasoning and same call shape as `earningsFormat.ts`'s
 * `formatEarningsMultiplier`), gets both the locale-correct WORD ORDER and
 * the translated month/weekday name for free — a Spanish reader gets
 * "jueves, 3 de septiembre", not an English month name mid-sentence.
 */
export function formatWeekdayLong(dateISO: string): string {
  if (!isValidCalendarDate(dateISO)) return dateISO;
  return new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(toLocalDate(dateISO));
}

/** "Aug 4" (en-US) — no year, for the "Today (…)" chip label. */
export function formatShortDate(dateISO: string): string {
  if (!isValidCalendarDate(dateISO)) return dateISO;
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
  }).format(toLocalDate(dateISO));
}

/** "Apr 1, 2026" (en-US) — with year, for "In effect since" / history rows. */
export function formatDisplayDateWithYear(dateISO: string): string {
  if (!isValidCalendarDate(dateISO)) return dateISO;
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(toLocalDate(dateISO));
}

/** Parses a typed hours field ("40", "1.5") to integer minutes. Blank -> null
 * (the field's "not set" state); anything unparsable or negative -> null too
 * — callers distinguish "blank" from "invalid" by checking the text first. */
export function parseHoursToMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours < 0) return null;
  return Math.round(hours * 60);
}

/**
 * API TWIN: `OvertimeMultiplierSchema` (shared-types payArrangement.schema)
 * — a `numeric(3,2)` column: at least 1, at most 9.99, at most two decimals.
 * The epsilon form avoids `multipleOf(0.01)`'s float false negatives
 * (8.88 / 0.01 !== 888). One function, because 078 added three more columns
 * bounded by exactly this shape (`doubletime_multiplier`,
 * `seventh_day_multiplier`) and four copies of it eventually disagree.
 */
function isValidMultiplier(multiplier: number): boolean {
  return (
    Number.isFinite(multiplier) &&
    multiplier >= 1 &&
    multiplier <= 9.99 &&
    Math.abs(multiplier * 100 - Math.round(multiplier * 100)) < 1e-9
  );
}

/**
 * Three-valued, because a tier's field has three states and conflating two of
 * them is how a refusal turns into a silent correction:
 *   `null`      — blank, an explicit "no tier" (valid, never an error)
 *   a number    — a valid value
 *   `undefined` — typed but invalid; the caller must REFUSE (playbook §2.9's
 *                 refuse-don't-clamp), never fall back to the blank arm.
 */
function parseOptionalThresholdMinutes(
  text: string
): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const minutes = parseHoursToMinutes(trimmed);
  // 078's `> 0` domain floors: "after 0 hours in a day" is not a tier.
  return minutes === null || minutes <= 0 ? undefined : minutes;
}

/** Same three-valued contract as `parseOptionalThresholdMinutes`. */
function parseOptionalMultiplier(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const multiplier = Number(trimmed);
  return isValidMultiplier(multiplier) ? multiplier : undefined;
}

/**
 * The household's current `cancellation_paid_within_hours` column allows
 * `0` (= no pay); the arrangement models that as `null`, never `0` (review
 * finding 10). This is the zero-maps-to-no-pay mapping, applied once here
 * so the setup/change forms don't each reinvent it.
 */
export function defaultCancellationChoiceFromHouseholdWindow(
  householdWindowHours: number
): 'window' | 'none' {
  return householdWindowHours > 0 ? 'window' : 'none';
}

export interface PayTermsFormState {
  /** Typed hourly rate, major units ("18.50"). */
  rateText: string;
  currency: string;
  /** The resolved date to submit — already "today" or the typed earlier date. */
  effectiveDateISO: string;
  /** Household-local today, "yyyy-mm-dd" — the no-future-dates ceiling. */
  todayISO: string;
  overtimeThresholdHoursText: string;
  overtimeMultiplierText: string;
  /**
   * The 078 tiers. Every one of these is REQUIRED on the state (never
   * optional) so the compiler names both forms the day a sixth is added —
   * playbook T17's failure mode is a new column that some screen forgets to
   * pass, which then silently never persists, and `?:` is exactly how that
   * happens.
   *
   * Daily overtime deliberately has NO multiplier field of its own: it is
   * paid at `overtime_multiplier`, the weekly one
   * (`docs/design/screens-pay-terms.md` §3).
   */
  dailyOvertimeThresholdHoursText: string;
  doubletimeThresholdHoursText: string;
  /** Shared: the daily double-time tier AND the seventh day's second tier
   * are both paid at this rate (078's header — two columns holding the same
   * number is two columns that eventually disagree). */
  doubletimeMultiplierText: string;
  seventhDayMultiplierText: string;
  seventhDayDoubletimeAfterHoursText: string;
  /**
   * 3-E4's `worked_holiday_multiplier` — the same numeric(3,2) shape, but
   * standing alone: it has no cross-field partner, because WHICH dates are
   * holidays is the household's observed list, not a term of this
   * arrangement. Blank is null ("a worked holiday pays the normal rate"),
   * never a fabricated 1.5.
   */
  workedHolidayMultiplierText: string;
  guaranteedHoursText: string;
  ptoHoursPerYearText: string;
  mileageRateText: string;
  cancellationChoice: 'window' | 'none' | null;
  cancellationHoursText: string;
  note: string;
  /**
   * 082 (D-17, T7 reversal). PRESENTATION ONLY — `''` means "no pay schedule
   * stated". Two day fields, not one: `payDayOfWeekText` reads only for
   * weekly/biweekly, `payDayOfMonthText` only for semimonthly/monthly (see
   * `payArrangement.schema.ts`'s comment). Both are plain optional text —
   * a chosen frequency with no day typed is still a valid request.
   */
  payFrequency: PayFrequency | '';
  payDayOfWeekText: string;
  payDayOfMonthText: string;
  /**
   * The CURRENT arrangement's `overtime_multiplier` — carried through
   * unchanged when the threshold field is blank (review finding 6), so a
   * rate-only change never silently rewrites a non-default stored
   * multiplier back to the 1.5 default. Omit (leave `undefined`) only when
   * there IS no current arrangement yet — `PaySetupScreen`'s first-ever
   * arrangement — where 1.5 is genuinely the correct blank-threshold
   * default.
   */
  currentOvertimeMultiplier?: number;
}

/**
 * Builds the POST body, or `null` if any field is invalid — including a
 * missing cancellation choice, which the setup flow requires explicitly
 * (TIER0-CX-SPEC.md §2 "First-time setup": "this is the one term where
 * silence breeds the dispute").
 */
export function buildCreatePayArrangementRequest(
  state: PayTermsFormState
): CreatePayArrangementRequest | null {
  const rateMinor = parseMajorToMinor(state.rateText);
  if (rateMinor === null) return null;

  if (!isValidCalendarDate(state.effectiveDateISO)) return null;
  // ISO "yyyy-mm-dd" strings compare correctly lexicographically.
  if (state.effectiveDateISO > state.todayISO) return null;

  let overtimeThresholdMinutes: number | null = null;
  // Blank threshold: carry the current arrangement's multiplier through
  // unchanged rather than hardcoding 1.5 (review finding 6) — there is no
  // current arrangement only on the first-ever setup screen, where 1.5 is
  // the correct default.
  let overtimeMultiplier = state.currentOvertimeMultiplier ?? 1.5;
  const thresholdTrimmed = state.overtimeThresholdHoursText.trim();
  if (thresholdTrimmed !== '') {
    const minutes = parseHoursToMinutes(thresholdTrimmed);
    if (minutes === null || minutes <= 0) return null;
    const multiplier = Number(state.overtimeMultiplierText.trim());
    if (!isValidMultiplier(multiplier)) return null;
    overtimeThresholdMinutes = minutes;
    overtimeMultiplier = multiplier;
  }

  // ---------------------------------------------------------------------
  // 078's daily tiers and the seventh day. Every branch below REFUSES
  // (returns null, disabling the caller's save button) rather than clamping
  // or dropping a field — playbook §2.9. Each cross-field rule below names
  // the migration CHECK it mirrors: the DB is the last line, this is the
  // fast-fail so a parent is told before the network call, not after.
  // ---------------------------------------------------------------------
  const dailyOvertimeThresholdMinutes = parseOptionalThresholdMinutes(
    state.dailyOvertimeThresholdHoursText
  );
  if (dailyOvertimeThresholdMinutes === undefined) return null;

  const doubletimeThresholdMinutes = parseOptionalThresholdMinutes(
    state.doubletimeThresholdHoursText
  );
  if (doubletimeThresholdMinutes === undefined) return null;

  const doubletimeMultiplier = parseOptionalMultiplier(
    state.doubletimeMultiplierText
  );
  if (doubletimeMultiplier === undefined) return null;

  const seventhDayMultiplier = parseOptionalMultiplier(
    state.seventhDayMultiplierText
  );
  if (seventhDayMultiplier === undefined) return null;

  const seventhDayDoubletimeAfterMinutes = parseOptionalThresholdMinutes(
    state.seventhDayDoubletimeAfterHoursText
  );
  if (seventhDayDoubletimeAfterMinutes === undefined) return null;

  // pay_arrangements_doubletime_daily_needs_multiplier
  if (doubletimeThresholdMinutes !== null && doubletimeMultiplier === null) {
    return null;
  }
  // pay_arrangements_daily_tiers_ordered — strictly greater, so "double time
  // after 8h, overtime after 8h" is refused too, not silently collapsed.
  if (
    doubletimeThresholdMinutes !== null &&
    dailyOvertimeThresholdMinutes !== null &&
    doubletimeThresholdMinutes <= dailyOvertimeThresholdMinutes
  ) {
    return null;
  }
  // pay_arrangements_seventh_day_second_tier_needs_multiplier
  if (
    seventhDayDoubletimeAfterMinutes !== null &&
    (seventhDayMultiplier === null || doubletimeMultiplier === null)
  ) {
    return null;
  }

  // 3-E4. No cross-field rule of its own — the premium is agreed here, the
  // dates it applies to are the household's observed list.
  const workedHolidayMultiplier = parseOptionalMultiplier(
    state.workedHolidayMultiplierText
  );
  if (workedHolidayMultiplier === undefined) return null;

  let guaranteedMinutesPerWeek: number | null = null;
  if (state.guaranteedHoursText.trim() !== '') {
    const minutes = parseHoursToMinutes(state.guaranteedHoursText);
    if (minutes === null) return null;
    guaranteedMinutesPerWeek = minutes;
  }

  let ptoEntitlementMinutesPerYear: number | null = null;
  if (state.ptoHoursPerYearText.trim() !== '') {
    const minutes = parseHoursToMinutes(state.ptoHoursPerYearText);
    if (minutes === null) return null;
    ptoEntitlementMinutesPerYear = minutes;
  }

  let mileageRatePerMileMinor: number | null = null;
  if (state.mileageRateText.trim() !== '') {
    const minor = parseMajorToMinor(state.mileageRateText);
    if (minor === null) return null;
    mileageRatePerMileMinor = minor;
  }

  if (state.cancellationChoice === null) return null;
  let cancellationPaidWithinHours: number | null = null;
  if (state.cancellationChoice === 'window') {
    const hoursText = state.cancellationHoursText.trim();
    const hours = Number(hoursText);
    if (
      hoursText === '' ||
      !Number.isFinite(hours) ||
      !Number.isInteger(hours) ||
      hours <= 0
    ) {
      return null;
    }
    cancellationPaidWithinHours = hours;
  }

  // ---------------------------------------------------------------------
  // 082's pay schedule (D-17, T7 reversal). PRESENTATION ONLY — see
  // `payArrangement.schema.ts`'s comment. Which day field is READ depends on
  // the chosen frequency; the other is always sent as null, never whatever
  // stale text sits in the field the family isn't using.
  // ---------------------------------------------------------------------
  const payFrequency: PayFrequency | null =
    state.payFrequency === '' ? null : state.payFrequency;
  let payDayOfWeek: number | null = null;
  let payDayOfMonth: number | null = null;
  if (payFrequency === 'weekly' || payFrequency === 'biweekly') {
    const trimmed = state.payDayOfWeekText.trim();
    if (trimmed !== '') {
      const day = Number(trimmed);
      if (!Number.isInteger(day) || day < 0 || day > 6) return null;
      payDayOfWeek = day;
    }
  } else if (payFrequency === 'semimonthly' || payFrequency === 'monthly') {
    const trimmed = state.payDayOfMonthText.trim();
    if (trimmed !== '') {
      const day = Number(trimmed);
      if (!Number.isInteger(day) || day < 1 || day > 31) return null;
      payDayOfMonth = day;
    }
  }

  const trimmedNote = state.note.trim();

  return {
    rate_minor: rateMinor,
    currency: state.currency,
    overtime_threshold_minutes: overtimeThresholdMinutes,
    overtime_multiplier: overtimeMultiplier,
    // All five are always present, `null` when the tier is off — never
    // omitted. A key the request doesn't carry is a column the insert never
    // writes (playbook T17).
    overtime_daily_threshold_minutes: dailyOvertimeThresholdMinutes,
    doubletime_daily_threshold_minutes: doubletimeThresholdMinutes,
    doubletime_multiplier: doubletimeMultiplier,
    seventh_day_multiplier: seventhDayMultiplier,
    seventh_day_doubletime_after_minutes: seventhDayDoubletimeAfterMinutes,
    worked_holiday_multiplier: workedHolidayMultiplier,
    pay_frequency: payFrequency,
    pay_day_of_week: payDayOfWeek,
    pay_day_of_month: payDayOfMonth,
    guaranteed_minutes_per_week: guaranteedMinutesPerWeek,
    pto_entitlement_minutes_per_year: ptoEntitlementMinutesPerYear,
    mileage_rate_per_mile_minor: mileageRatePerMileMinor,
    cancellation_paid_within_hours: cancellationPaidWithinHours,
    valid_from: state.effectiveDateISO,
    note: trimmedNote === '' ? undefined : trimmedNote,
  };
}

export interface MidWeekConsequence {
  oldRateLabel: string;
  oldUntilLabel: string;
  newRateLabel: string;
  newFromLabel: string;
}

/**
 * `null` when the effective date IS the household's week start (no split —
 * the ordinary case), isn't a valid date yet, or the rate+currency are
 * unchanged from the previous arrangement (pre-fill is not a split).
 * TIER0-CX-SPEC.md §2's "whenever the chosen date is not the first day of
 * the week" — never averaged, always the two full figures. Rate-specific
 * copy only; other mid-week term changes stay silent here by design.
 */
export function buildMidWeekConsequence(
  effectiveDateISO: string,
  weekStartsOn: number,
  previousRateMinor: number,
  previousCurrency: string,
  newRateMinor: number,
  newCurrency: string
): MidWeekConsequence | null {
  if (!isValidCalendarDate(effectiveDateISO)) return null;
  if (isWeekStartDay(effectiveDateISO, weekStartsOn)) return null;
  if (previousRateMinor === newRateMinor && previousCurrency === newCurrency) {
    return null;
  }
  const untilDateISO = addLocalDays(effectiveDateISO, -1);
  return {
    oldRateLabel: formatMoney(previousRateMinor, previousCurrency),
    oldUntilLabel: formatWeekdayLong(untilDateISO),
    newRateLabel: formatMoney(newRateMinor, newCurrency),
    newFromLabel: formatWeekdayLong(effectiveDateISO),
  };
}

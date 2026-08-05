/**
 * @module domains/pay/utils/payArrangementForm
 *
 * Pure date/number helpers + the one function that turns typed form state
 * into a `CreatePayArrangementRequest` (or `null` when anything is invalid).
 * Kept dependency-free from React so it is exhaustively unit-testable
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
import type { CreatePayArrangementRequest } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { addLocalDays } from '@/src/lib/localDate';
import { formatMoney, parseMajorToMinor } from '@/src/lib/money';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTHS_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

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

/** True when `dateISO` falls on a Monday — the mid-week-consequence trigger
 * (TIER0-CX-SPEC.md §2's "Mid-week consequence line"). */
export function isMonday(dateISO: string): boolean {
  if (!isValidCalendarDate(dateISO)) return false;
  return toLocalDate(dateISO).getDay() === 1;
}

/** "3 September" style, no year — for the mid-week consequence line and the
 * "Today (4 Aug)" chip is handled separately (needs no year, no weekday). */
export function formatWeekdayLong(dateISO: string): string {
  if (!isValidCalendarDate(dateISO)) return dateISO;
  const [, m, d] = dateISO.split('-').map(Number);
  const date = toLocalDate(dateISO);
  return `${WEEKDAYS_LONG[date.getDay()]} ${d} ${MONTHS_LONG[(m ?? 1) - 1]}`;
}

/** "4 Aug" — no year, for the "Today (…)" chip label. */
export function formatShortDate(dateISO: string): string {
  if (!isValidCalendarDate(dateISO)) return dateISO;
  const [, m, d] = dateISO.split('-').map(Number);
  return `${d} ${MONTHS_ABBR[(m ?? 1) - 1]}`;
}

/** "1 Apr 2026" — with year, for "In effect since" / history rows. */
export function formatDisplayDateWithYear(dateISO: string): string {
  if (!isValidCalendarDate(dateISO)) return dateISO;
  const [y, m, d] = dateISO.split('-').map(Number);
  return `${d} ${MONTHS_ABBR[(m ?? 1) - 1]} ${y}`;
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
  guaranteedHoursText: string;
  ptoHoursPerYearText: string;
  mileageRateText: string;
  cancellationChoice: 'window' | 'none' | null;
  cancellationHoursText: string;
  note: string;
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
    if (!Number.isFinite(multiplier) || multiplier < 1) return null;
    overtimeThresholdMinutes = minutes;
    overtimeMultiplier = multiplier;
  }

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

  const trimmedNote = state.note.trim();

  return {
    rate_minor: rateMinor,
    currency: state.currency,
    overtime_threshold_minutes: overtimeThresholdMinutes,
    overtime_multiplier: overtimeMultiplier,
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
 * `null` when the effective date IS a Monday (no split — the ordinary case),
 * isn't a valid date yet, or the rate+currency are unchanged from the
 * previous arrangement (pre-fill is not a split). TIER0-CX-SPEC.md §2:
 * "Whenever the chosen date is not a Monday" — never averaged, always the
 * two full figures. Rate-specific copy only; other mid-week term changes
 * stay silent here by design.
 */
export function buildMidWeekConsequence(
  effectiveDateISO: string,
  previousRateMinor: number,
  previousCurrency: string,
  newRateMinor: number,
  newCurrency: string
): MidWeekConsequence | null {
  if (!isValidCalendarDate(effectiveDateISO)) return null;
  if (isMonday(effectiveDateISO)) return null;
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

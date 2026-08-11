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

/** D-16 (spec §6): how far into the future `valid_from` may be set — a bound,
 * not a refusal, mirroring `payArrangementCommandService`'s server-side
 * check exactly (`MAX_FUTURE_MONTHS`). */
const MAX_FUTURE_MONTHS = 12;

/**
 * The horizon date, `months` months after `dateISO` — same UTC-Date-rollover
 * technique as the server's `addMonthsISO` (and `payTermsPresets.ts`'s
 * `isPresetReviewStale`), so client and server can never quietly disagree
 * about where the 12-month line falls.
 */
function addMonthsISO(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1 + months, d ?? 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

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
   * The CURRENT arrangement's `overtime_multiplier` — carried through
   * unchanged when the threshold field is blank (review finding 6), so a
   * rate-only change never silently rewrites a non-default stored
   * multiplier back to the 1.5 default. Omit (leave `undefined`) only when
   * there IS no current arrangement yet — `PaySetupScreen`'s first-ever
   * arrangement — where 1.5 is genuinely the correct blank-threshold
   * default.
   */
  currentOvertimeMultiplier?: number;

  // -------------------------------------------------------------------
  // 3-U1 additions — the `terms` jsonb groups (spec §3/§4.3). Optional,
  // unlike the 078 tiers above: these are administrative text and
  // non-wage line items, never priced by the engine, so a screen that
  // omits them (or hasn't been rebuilt onto the "In writing"/"Outside
  // wages" groups yet) gets the same `terms` bag it always did — `{}` —
  // rather than being forced to state five blank strings.
  // -------------------------------------------------------------------
  /** "In writing" §4.3 — UI shows weeks, storage is `terms.notice_period_days`. */
  noticePeriodWeeksText?: string;
  probationDaysText?: string;
  /** Documentation only — feeds no pricing, selects no preset (§5.3). */
  dutiesText?: string;
  drivingText?: string;
  liveInText?: string;
  /** "Outside wages" §4.3/D-13 — `terms.recurring[]`, excluded from gross. */
  stipends?: readonly StipendFormRow[];
  /**
   * §5.2's recorded confirmation — set the moment a preset is applied,
   * carried through unchanged by every later re-render until the parent
   * edits a filled field (the caller's job; this module only writes it
   * through when present). `undefined` when no preset has been applied.
   */
  presetStamp?: PresetStamp;
}

/** One "Outside wages" row (D-13) — amount as major-unit text, like every
 * other money field in this form. */
export interface StipendFormRow {
  label: string;
  amountText: string;
  cadence: 'weekly' | 'monthly' | 'annual';
}

/** §5.2's recorded confirmation, written into `terms.preset`. */
export interface PresetStamp {
  id: string;
  version: number;
  applied_at: string;
  confirmed_by: string;
}

/**
 * Builds the `terms` jsonb bag from the "In writing" and "Outside wages"
 * groups (spec §3/§4.3) — the ONE place these fields turn into the
 * documentary-terms shape the server stores verbatim. `undefined` means
 * REFUSE (an invalid stipend amount), matching the refuse-not-clamp
 * discipline the 078 tiers use above. An empty bag `{}` — not `undefined` —
 * when nothing in these groups was filled in, matching the server's own
 * "omitted request resolves to `{}`" default (`payArrangementCommandService`).
 *
 * `state.presetStamp`, when present, is written through unchanged into
 * `terms.preset` — §5.2: "Applying a preset writes
 * `terms.preset = { id, version, applied_at, confirmed_by }`". Nothing in
 * this function decides WHEN to stamp one; that is the caller's job the
 * moment the D-7 confirm sheet is accepted.
 */
function buildTermsBag(
  state: PayTermsFormState
): Record<string, unknown> | undefined {
  const terms: Record<string, unknown> = {};

  const noticeWeeksTrimmed = (state.noticePeriodWeeksText ?? '').trim();
  if (noticeWeeksTrimmed !== '') {
    const weeks = Number(noticeWeeksTrimmed);
    if (!Number.isFinite(weeks) || weeks < 0) return undefined;
    // UI asks for weeks (§4.3: "Notice period [4] weeks"); storage is DAYS
    // (§3: `terms.notice_period_days`) — converted here, once, so no reader
    // has to know the UI unit ever differed from the stored one.
    terms.notice_period_days = Math.round(weeks * 7);
  }

  const probationTrimmed = (state.probationDaysText ?? '').trim();
  if (probationTrimmed !== '') {
    const days = Number(probationTrimmed);
    if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
      return undefined;
    }
    terms.probation_days = days;
  }

  // Documentation only — feeds no pricing, selects no preset (§5.3).
  // Trimmed to '' being the same as "not filled in": an empty string typed
  // and then deleted must not linger in the stored bag as a blank field.
  const duties = (state.dutiesText ?? '').trim();
  if (duties !== '') terms.duties = duties;
  const driving = (state.drivingText ?? '').trim();
  if (driving !== '') terms.driving = driving;
  const liveIn = (state.liveInText ?? '').trim();
  if (liveIn !== '') terms.live_in = liveIn;

  if (state.stipends && state.stipends.length > 0) {
    const recurring: {
      label: string;
      amount_minor: number;
      cadence: string;
    }[] = [];
    for (const stipend of state.stipends) {
      const label = stipend.label.trim();
      const amountMinor = parseMajorToMinor(stipend.amountText);
      // A row with neither a label nor an amount typed is an empty row the
      // UI offered and the parent never filled in — skipped, not refused.
      if (label === '' && stipend.amountText.trim() === '') continue;
      if (label === '' || amountMinor === null) return undefined;
      recurring.push({
        label,
        amount_minor: amountMinor,
        cadence: stipend.cadence,
      });
    }
    if (recurring.length > 0) terms.recurring = recurring;
  }

  if (state.presetStamp) {
    terms.preset = { ...state.presetStamp };
  }

  return terms;
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
  // D-16 (spec §6) reverses the old no-future-dating rule: a scheduled raise
  // is the normal case now, bounded in the OPPOSITE direction — a
  // `valid_from` more than 12 months out is refused (the same shape of
  // check `payArrangementCommandService.create`'s `addMonthsISO` makes
  // server-side; this is the client's fast-fail twin, never the source of
  // truth). ISO "yyyy-mm-dd" strings compare correctly lexicographically.
  if (
    state.effectiveDateISO > addMonthsISO(state.todayISO, MAX_FUTURE_MONTHS)
  ) {
    return null;
  }

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

  const trimmedNote = state.note.trim();

  const terms = buildTermsBag(state);
  if (terms === undefined) return null;

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
    guaranteed_minutes_per_week: guaranteedMinutesPerWeek,
    pto_entitlement_minutes_per_year: ptoEntitlementMinutesPerYear,
    mileage_rate_per_mile_minor: mileageRatePerMileMinor,
    cancellation_paid_within_hours: cancellationPaidWithinHours,
    valid_from: state.effectiveDateISO,
    terms,
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

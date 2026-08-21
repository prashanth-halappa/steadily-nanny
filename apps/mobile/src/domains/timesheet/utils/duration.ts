/**
 * @module domains/timesheet/utils/duration
 * Pure duration formatting for clock in/out and the hours screen. Totals
 * follow the app language ("6h 12m" en, "6 h 12 min" es); the live timer uses
 * HH:MM — no user-visible time or duration in this app shows seconds. Clock
 * *display* follows the device
 * locale's 12h/24h preference while staying in the household IANA zone
 * (GOLDEN-FIXES #21).
 */
import i18n from '@/src/i18n';
import {
  formatInstantDisplay,
  utcIsoToWallClockHHMM,
} from '@/src/lib/wallClock';

/** Minutes in one hour, for readability at call sites. */
const MINUTES_PER_HOUR = 60;

/**
 * Duration unit suffixes per language. English abbreviates tight ("8h 52m");
 * Spanish writes the SI-style spaced form ("8 h 52 min") — "8h 52m" is not
 * Spanish, it is untranslated English, and it was leaking onto every screen
 * that shows a total.
 *
 * A two-entry lookup rather than `Intl.NumberFormat`'s `unit` style: that
 * formatter renders "8 h" and "52 min" fine but has no way to join them into
 * one figure, so composing the pair by hand is unavoidable either way.
 */
interface DurationUnits {
  hour: string;
  minute: string;
}

const EN_DURATION_UNITS: DurationUnits = { hour: 'h', minute: 'm' };

const DURATION_UNITS: Record<string, DurationUnits> = {
  en: EN_DURATION_UNITS,
  es: { hour: ' h', minute: ' min' },
};

function durationUnits(): DurationUnits {
  const language = i18n.language?.split('-')[0] ?? 'en';
  return DURATION_UNITS[language] ?? EN_DURATION_UNITS;
}

/**
 * "6h 14m" / "2h" (no trailing "0m") / "45m" / "0h", in the app's current
 * language ("6 h 14 min" / "2 h" / "45 min" / "0 h" in es). Zero uses the
 * hour unit so it reads as a figure next to "13h"/"9h" — "0m" was misread
 * as the word "Om". Negative input is clamped to 0 — it should never happen
 * with real data, but a display helper must not print a negative duration.
 */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainder = minutes % MINUTES_PER_HOUR;
  const units = durationUnits();

  // Zero → hour unit ("0h" / "0 h"). Sub-hour non-zero stays minutes-only.
  if (minutes === 0) return `0${units.hour}`;
  if (hours === 0) return `${remainder}${units.minute}`;
  if (remainder === 0) return `${hours}${units.hour}`;
  return `${hours}${units.hour} ${remainder}${units.minute}`;
}

/**
 * Elapsed time between a clock-in instant and "now", formatted the same way
 * as `formatDuration`. Clamped so a clock skew that puts `nowMs` slightly
 * before `startIso` never shows a negative timer.
 */
export function formatElapsedSince(startIso: string, nowMs: number): string {
  const startMs = new Date(startIso).getTime();
  const elapsedMinutes = (nowMs - startMs) / (MINUTES_PER_HOUR * 1000);
  return formatDuration(elapsedMinutes);
}

/**
 * Live elapsed clock `HH:MM` (zero-padded, floored down to the minute).
 * Used by the Today timer — never renders seconds (product decision: no
 * user-visible time ever shows seconds, hh:mm only).
 */
export function formatElapsedClock(startIso: string, nowMs: number): string {
  const startMs = new Date(startIso).getTime();
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const hours = Math.floor(elapsedSec / 3600);
  const minutes = Math.floor((elapsedSec % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * "2h over scheduled" / "40 min under scheduled" against a scheduled figure,
 * or `null` when there is nothing to compare against (no scheduled shift) or
 * the two match exactly (nothing worth stating).
 *
 * TIER0-CX-SPEC.md §4.2 amendment: once `WeekEarningsLine` can render an
 * "Overtime pay" row on the SAME card, this delta must never read as a
 * second overtime figure. The previous copy ("+14 min" / "-40 min") never
 * literally said "overtime", but a bare signed number sitting next to a paid
 * "Overtime pay" line invites exactly that misreading — the fix is the
 * explicit "vs scheduled" framing the spec's own example uses ("2h over
 * scheduled"), not a word swap. Magnitude formatting is delegated to
 * `formatDuration` (so an hour-plus delta reads "2h", not "120 min") — same
 * duration-rendering rule, just no longer minutes-only.
 *
 * i18n (review finding 5a): this is a pure module with no `t` in scope (no
 * React tree to pull `useTranslation` from), so it calls the shared `i18n`
 * instance directly — the same house pattern as
 * `domains/schedule/utils/calendarSyncNative.ts`'s `resolveEventLabels`,
 * rather than inventing a translator-injection parameter.
 */
export function formatOvertimeDelta(
  actualMinutes: number,
  scheduledMinutes: number | null
): string | null {
  if (scheduledMinutes === null) return null;
  const delta = Math.round(actualMinutes - scheduledMinutes);
  if (delta === 0) return null;
  const duration = formatDuration(Math.abs(delta));
  return delta > 0
    ? i18n.t('hours:overScheduled', { duration })
    : i18n.t('hours:underScheduled', { duration });
}

/**
 * Locale-aware clock display in the HOUSEHOLD's IANA zone. Pass `locale`
 * only in tests — production uses the device default so a 12-hour device
 * does not show "17:28" under a status bar that reads "5:28".
 *
 * Wire/forms still use `utcIsoToWallClockHHMM` (always 24h).
 */
export function formatClockTime(
  iso: string,
  timeZone: string,
  locale?: string
): string {
  return formatInstantDisplay(iso, timeZone, locale);
}

/** Always-24h wall clock for form defaults — re-export for callers that need it. */
export { utcIsoToWallClockHHMM };

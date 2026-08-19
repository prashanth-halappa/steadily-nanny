/**
 * @module domains/pay/components/EffectiveDateField.utils
 *
 * Pure "yyyy-mm-dd" helpers for `EffectiveDateField`, kept dependency-free so
 * bun:test can unit-test the real date-picker boundary logic directly. The
 * wire format everywhere outside this file stays the nominal calendar-date
 * string; `Date` objects exist only transiently here for the native picker.
 */

const MAX_FUTURE_MONTHS = 12;

/** Parses a "yyyy-mm-dd" string into a Date at local midnight. */
export function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

/** Formats a Date's local calendar-date components back to "yyyy-mm-dd". */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Mirrors payArrangementForm's 12-month horizon for the native picker cap. */
export function maximumDate(todayISO: string): Date {
  const [y, m, d] = todayISO.split('-').map(Number);
  const utcDate = new Date(
    Date.UTC(y ?? 0, (m ?? 1) - 1 + MAX_FUTURE_MONTHS, d ?? 1)
  );
  return new Date(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth(),
    utcDate.getUTCDate(),
    0,
    0,
    0,
    0
  );
}

/** Past dates hint that already-approved weeks keep their approved totals. */
export function shouldShowBackdatingHint(
  value: string,
  todayISO: string
): boolean {
  return value !== '' && value < todayISO;
}

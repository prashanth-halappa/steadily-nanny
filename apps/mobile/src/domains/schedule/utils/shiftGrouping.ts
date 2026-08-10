/**
 * @module domains/schedule/utils/shiftGrouping
 * Shared helpers for calendar views — day grouping and time-period buckets.
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { formatInstantInZone, timeToMinutes } from '@/src/lib/displayTime';
import { formatInstantDisplay } from '@/src/lib/wallClock';

export type ListItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'shift'; key: string; shift: Shift };

/** Statuses that read as a resolved record, not a thing to act on (T4) — a
 * cancelled or declined shift never counts as cover for a duration total. */
export const RESOLVED_STATUSES = new Set<Shift['status']>([
  'cancelled',
  'declined',
]);

/** Whole-minute duration between two ISO instants, floored (never negative
 * with real data, but a display sum must not go negative). */
export function shiftMinutes(shift: Shift): number {
  const minutes =
    (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) /
    60000;
  return Math.max(0, minutes);
}

/** Total covering minutes across `shifts`, excluding cancelled/declined —
 * the same rule AgendaView's day-header totals and the Schedule tab's
 * week-total figure both use. */
export function totalCoveringMinutes(shifts: readonly Shift[]): number {
  return shifts
    .filter(shift => !RESOLVED_STATUSES.has(shift.status))
    .reduce((sum, shift) => sum + shiftMinutes(shift), 0);
}

/** Parses YYYY-MM-DD into local calendar weekday (0=Sun..6=Sat). */
export function localDateToWeekday(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).getDay();
}

export function groupShiftsByDay(
  shifts: Shift[],
  weekdayLabel: (dow: number) => string
): ListItem[] {
  const sorted = [...shifts].sort((a, b) =>
    a.local_date === b.local_date
      ? a.starts_at.localeCompare(b.starts_at)
      : a.local_date.localeCompare(b.local_date)
  );

  const items: ListItem[] = [];
  let currentDate: string | null = null;
  for (const shift of sorted) {
    if (shift.local_date !== currentDate) {
      currentDate = shift.local_date;
      items.push({
        type: 'header',
        key: `header-${shift.local_date}`,
        label: `${weekdayLabel(localDateToWeekday(shift.local_date))} · ${formatDisplayDate(shift.local_date)}`,
      });
    }
    items.push({ type: 'shift', key: shift.id, shift });
  }
  return items;
}

export function formatShiftTime(
  isoInstant: string,
  timeZone?: string | null,
  locale?: string
): string {
  if (timeZone) {
    return formatInstantDisplay(isoInstant, timeZone, locale);
  }
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Minutes since midnight (0–1439) in `timeZone` for an ISO instant.
 * The `% 1440` normalises the "24:00" some ICU builds emit for midnight
 * under a 24-hour cycle back to 0.
 */
export function minutesInZone(
  iso: string,
  timeZone: string | null | undefined
): number {
  if (timeZone) {
    return timeToMinutes(formatInstantInZone(iso, timeZone)) % 1440;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return (date.getHours() * 60 + date.getMinutes()) % 1440;
}

/**
 * Does a shift occupying `[startMinutes, endMinutes)` of the day overlap the
 * one-hour grid cell that begins at `hour`?
 *
 * Replaces the old `hour >= startH && hour < endH` test on bare hour-of-day
 * integers, which silently dropped two whole classes of shift:
 *  - OVERNIGHT — a 19:00–00:30 shift has `endH === 0`, so `hour < 0` was
 *    never true and the shift rendered as complete absence.
 *  - SUB-HOUR — a 09:15–09:45 shift has `startH === endH === 9`, so
 *    `9 >= 9 && 9 < 9` was false and it rendered as absent too.
 *
 * This is a half-open interval overlap instead, with the wrap-past-midnight
 * case handled as the union of `[start, 24:00)` and `[00:00, end)`. An end
 * at or before the start means "next day" — the same convention
 * `ShiftDetailScreen` applies when it builds the instants.
 */
export function hourCellOccupied(
  startMinutes: number,
  endMinutes: number,
  hour: number
): boolean {
  const cellStart = hour * 60;
  const cellEnd = cellStart + 60;
  if (endMinutes <= startMinutes) {
    return startMinutes < cellEnd || cellStart < endMinutes;
  }
  return startMinutes < cellEnd && cellStart < endMinutes;
}

/** Hour in zone from an ISO instant (0–23). */
export function hourInZone(iso: string, timeZone: string): number {
  const label = formatInstantInZone(iso, timeZone);
  const [h] = label.split(':');
  return Number(h) || 0;
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

/** Classify a shift into morning (7–12), afternoon (12–17), evening (17–23). */
export function shiftPeriod(shift: Shift, timeZone: string): DayPeriod {
  const startHour = hourInZone(shift.starts_at, timeZone);
  if (startHour < 12) return 'morning';
  if (startHour < 17) return 'afternoon';
  return 'evening';
}

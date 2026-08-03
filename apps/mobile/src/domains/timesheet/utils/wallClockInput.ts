/**
 * @module domains/timesheet/utils/wallClockInput
 *
 * Parses what a carer types into a clock-time field to the canonical
 * 24-hour "HH:MM" the rest of this domain speaks (`wallClockToUtcIso`,
 * `utcIsoToWallClockHHMM`). Pure and dependency-free.
 *
 * A typed field rather than `@react-native-community/datetimepicker`
 * deliberately: that module ships raw Flow-typed source that `bun:test`
 * cannot parse, so importing it into `ClockOutSheet` would make the sheet
 * untestable (see `components/ui/time-range-picker.tsx`'s own note). The
 * field is also the surface a correction is typed into once in a while, not
 * a control used every day — and it sidesteps the un-themed native picker
 * of Daylight UX #41 entirely.
 *
 * Accepts what someone actually types on a number pad: "1730", "17:30",
 * "9:05", "9:5". Rejects anything that isn't a real time — returning null
 * rather than coercing, because silently reading "25:00" as 01:00 would
 * write an hour the carer never meant into a pay record.
 */

/** Canonical 24-hour "HH:MM", or null when the text isn't a valid time. */
export function parseWallClockInput(text: string): string | null {
  const trimmed = text.trim();
  // Bare digits from a number pad: "930" -> 9:30, "1730" -> 17:30.
  const bare = /^(\d{1,2})(\d{2})$/.exec(trimmed);
  const separated = /^(\d{1,2})\s*[:.]\s*(\d{1,2})$/.exec(trimmed);
  const match = separated ?? bare;
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

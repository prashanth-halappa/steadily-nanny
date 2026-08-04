/**
 * @module domains/schedule/utils/timeOffOverlap
 * Pure helpers — does a carer time-off row cover a local calendar date?
 */
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { addLocalDays } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';

/** True when [starts_at, ends_at) overlaps the local calendar day in `timeZone`. */
export function timeOffCoversLocalDate(
  row: Pick<CarerTimeOff, 'starts_at' | 'ends_at' | 'status'>,
  localDate: string,
  timeZone: string
): boolean {
  if (row.status === 'cancelled') return false;
  const dayStartMs = new Date(
    wallClockToUtcIso(localDate, '00:00', timeZone)
  ).getTime();
  const dayEndMs = new Date(
    wallClockToUtcIso(addLocalDays(localDate, 1), '00:00', timeZone)
  ).getTime();
  const rangeStart = new Date(row.starts_at).getTime();
  const rangeEnd = new Date(row.ends_at).getTime();
  if (Number.isNaN(dayStartMs) || Number.isNaN(dayEndMs)) return false;
  if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd)) return false;
  return rangeStart < dayEndMs && rangeEnd > dayStartMs;
}

export function timeOffRowsForLocalDate(
  rows: readonly CarerTimeOff[],
  localDate: string,
  timeZone: string
): CarerTimeOff[] {
  return rows.filter(row => timeOffCoversLocalDate(row, localDate, timeZone));
}

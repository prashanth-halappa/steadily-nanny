/**
 * @module domains/today/hooks/useTodayCoverageGaps
 *
 * Today's `coverage_gap` day-thread events — lifted out of
 * `CoverageGapBanner` so `TodayScreen` can ask "is there a gap today" for
 * T1 arbitration without a second query (same cache-hit-not-refetch pattern
 * as `useTodayCoverRows`).
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useDayThread } from '@/src/hooks/queries/useDayThread';
import { localDateInZone } from '@/src/lib/localDate';

export function useTodayCoverageGaps(
  householdId: string | null | undefined,
  timeZone: string | null | undefined
): { gaps: ShiftEvent[] } {
  const localDate = timeZone ? localDateInZone(timeZone) : null;
  const dayThread = useDayThread(householdId, localDate);
  return {
    gaps: (dayThread.data ?? []).filter(e => e.event_type === 'coverage_gap'),
  };
}

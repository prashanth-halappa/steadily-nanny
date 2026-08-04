/**
 * Clash warnings for schedule-pattern write paths (send / amend / accept).
 *
 * Expands the next fortnight of occurrences and collects non-blocking
 * warnings for the assigned carer — same warn-never-block rule as
 * `collectClashWarningsForCarer` on single-shift writes.
 *
 * Controllers MUST call this BEFORE materialisation (respond accept / amend).
 * Materialised pending/confirmed rows land in `v_busy_blocks` and would
 * otherwise self-clash every occurrence.
 *
 * @module domains/schedule/services/patternClashWarnings
 */
import type { ClashWarning } from '@steadily-nanny/shared-types/schemas/me.schema';
import type { AmendSchedulePatternInput } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import {
  type ClashWarningDeps,
  collectClashWarningsForCarer,
} from '../../me/services/clashWarning';
import { localDateOf } from '../../timesheet/utils/weekStart';
import { expandRecurrence } from './recurrenceExpander';
import { deriveOccurrenceIcalUid } from './scheduleMaterialisationService';
import type { SchedulePatternWithDays } from './schedulePatternQueryService';

const WARNING_HORIZON_DAYS = 14;

function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

function warningKey(w: ClashWarning): string {
  return [w.kind, w.starts_at ?? '', w.ends_at ?? '', w.busy_kind ?? ''].join(
    '|'
  );
}

export type CollectPatternClashWarnings = (
  carerId: string,
  proposed: {
    startsAt: string;
    endsAt: string;
    timezone: string;
  },
  options?: { ignoreExact?: { sourceUid: string } },
  deps?: ClashWarningDeps
) => Promise<ClashWarning[]>;

/**
 * Overlay amend body onto a with-days pattern so warnings reflect the
 * post-amend recurrence shape without waiting for the write + materialise.
 */
export function patternWithAmendOverlay(
  pattern: SchedulePatternWithDays,
  input: AmendSchedulePatternInput
): SchedulePatternWithDays {
  return {
    ...pattern,
    ...(input.exdates !== undefined ? { exdates: input.exdates } : {}),
    ...(input.pause_ranges !== undefined
      ? { pause_ranges: input.pause_ranges }
      : {}),
    ...(input.until !== undefined ? { until: input.until } : {}),
  };
}

/**
 * Non-blocking clash heads-ups for a pattern's assigned carer over the next
 * fortnight of occurrences. Empty when there is no carer or no days.
 */
export async function collectClashWarningsForPattern(
  pattern: SchedulePatternWithDays,
  now: Date = new Date(),
  collect: CollectPatternClashWarnings = collectClashWarningsForCarer
): Promise<ClashWarning[]> {
  if (!pattern.carer_id || pattern.days.length === 0) {
    return [];
  }

  const today = localDateOf(now, pattern.timezone);
  const horizonStart = pattern.dtstart > today ? pattern.dtstart : today;
  const horizonEnd = addCalendarDays(horizonStart, WARNING_HORIZON_DAYS);

  const occurrences = expandRecurrence(
    {
      rrule: pattern.rrule,
      dtstart: pattern.dtstart,
      until: pattern.until,
      exdates: pattern.exdates,
      pauseRanges: pattern.pause_ranges,
      timezone: pattern.timezone,
      days: pattern.days.map(day => ({
        weekday: day.weekday,
        startTime: day.start_time,
        endTime: day.end_time,
        children: day.children.map(child => ({
          childId: child.child_id,
          startTime: child.start_time,
          endTime: child.end_time,
        })),
      })),
    },
    horizonEnd
  ).filter(o => o.localDate >= horizonStart);

  const carerId = pattern.carer_id;
  const batches = await Promise.all(
    occurrences.map(occurrence =>
      collect(
        carerId,
        {
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          timezone: pattern.timezone,
        },
        // An already-materialised pattern (amend runs only on `accepted`) has
        // its own occurrences in `v_busy_blocks`; ignore each by its
        // deterministic uid so it does not clash with itself. No-op on
        // send/respond, where nothing is materialised yet.
        {
          ignoreExact: {
            sourceUid: deriveOccurrenceIcalUid(
              pattern.ical_uid,
              occurrence.localDate
            ),
          },
        }
      )
    )
  );

  const seen = new Set<string>();
  const warnings: ClashWarning[] = [];
  for (const batch of batches) {
    for (const warning of batch) {
      const key = warningKey(warning);
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push(warning);
    }
  }

  return warnings;
}

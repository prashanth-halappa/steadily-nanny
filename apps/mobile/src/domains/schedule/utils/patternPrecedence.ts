/**
 * @module domains/schedule/utils/patternPrecedence
 *
 * Picks the one schedule pattern the Schedule tab speaks for.
 *
 * A household accumulates rows — a week gets built, withdrawn, rebuilt,
 * sent again — and `GET /schedule-patterns` returns all of them in no
 * guaranteed order. The tab used to take the first non-`ended` row, so a
 * stale `withdrawn` could outrank a week genuinely sitting with the nanny
 * and the banner said "You withdrew your usual week" while she was looking
 * at it. Order by what the parent needs to know about, most urgent first,
 * then by recency.
 */
import {
  SCHEDULE_PATTERN_STATUSES,
  type SchedulePattern,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';

/**
 * Most urgent first. `pending` outranks `accepted` because a week awaiting
 * a reply is the live question; `ended` is last but no longer excluded —
 * "your usual week has ended" is a truer banner than "no usual week yet".
 */
const STATUS_ORDER: readonly string[] = [
  SCHEDULE_PATTERN_STATUSES.PENDING,
  SCHEDULE_PATTERN_STATUSES.ACCEPTED,
  SCHEDULE_PATTERN_STATUSES.DRAFT,
  SCHEDULE_PATTERN_STATUSES.DECLINED,
  SCHEDULE_PATTERN_STATUSES.WITHDRAWN,
  SCHEDULE_PATTERN_STATUSES.ENDED,
];

/** Unknown or absent status sorts after every known one, never throws. */
function rank(pattern: SchedulePattern): number {
  const index = STATUS_ORDER.indexOf(pattern?.status);
  return index === -1 ? STATUS_ORDER.length : index;
}

/**
 * The pattern the banner should describe, or null when the household has
 * none at all.
 */
export function resolveActivePattern(
  patterns: readonly SchedulePattern[]
): SchedulePattern | null {
  let best: SchedulePattern | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const pattern of patterns) {
    const patternRank = rank(pattern);
    if (
      best === null ||
      patternRank < bestRank ||
      // Same status: the most recently created row is the live one.
      (patternRank === bestRank &&
        (pattern.created_at ?? '') > (best.created_at ?? ''))
    ) {
      best = pattern;
      bestRank = patternRank;
    }
  }

  return best;
}

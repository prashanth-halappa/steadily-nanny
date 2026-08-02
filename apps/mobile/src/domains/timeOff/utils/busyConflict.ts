/**
 * @module domains/timeOff/utils/busyConflict
 *
 * Pure overlap helpers for D30 — warn when a time-off request overlaps a
 * confirmed/pending shift (`other_commitment`) or personal calendar busy
 * (`personal`). Existing `time_off` blocks do not count: booking adjacent or
 * overlapping time off is not the coordination hole this defect covers.
 *
 * Interval semantics match `BusyBlockRepository.listForCarer`: half-open
 * overlap (`starts_at < rangeEnd && ends_at > rangeStart`). Touching endpoints
 * are not overlaps.
 */
import type { AnonymisedBusyBlock } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { BUSY_BLOCK_KINDS } from '@steadily-nanny/shared-types/schemas/availability.schema';

const CONFLICT_KINDS = new Set<string>([
  BUSY_BLOCK_KINDS.OTHER_COMMITMENT,
  BUSY_BLOCK_KINDS.PERSONAL,
]);

export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Busy blocks that should trigger a warn-and-confirm before submitting time off.
 */
export function findConflictingBusyBlocks(
  startsAt: string,
  endsAt: string,
  busyBlocks: AnonymisedBusyBlock[]
): AnonymisedBusyBlock[] {
  return busyBlocks.filter(
    block =>
      CONFLICT_KINDS.has(block.kind) &&
      intervalsOverlap(startsAt, endsAt, block.starts_at, block.ends_at)
  );
}

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

/**
 * Compared as instants, not as text. Both sides used to be compared with `<`
 * on the raw strings, which is only correct while every input is spelled the
 * same way — and they are not: one side is built locally by
 * `wallClockToUtcIso` (`...T09:00:00.000Z`) and the other comes back from the
 * API, where a `timestamptz` can serialise as `...T09:00:00+00:00`. `'+'`
 * sorts before `'.'`, so the same instant could compare as earlier. Parsing
 * makes the spelling irrelevant. An unparseable input yields NaN, and every
 * NaN comparison is false — i.e. "no overlap", the same non-blocking answer
 * these advisory checks give when a lookup fails.
 */
export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return (
    Date.parse(aStart) < Date.parse(bEnd) &&
    Date.parse(aEnd) > Date.parse(bStart)
  );
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

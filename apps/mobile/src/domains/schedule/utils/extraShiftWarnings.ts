/**
 * @module domains/schedule/utils/extraShiftWarnings
 *
 * Pure pre-submit checks for one-off extra shifts: past start, household
 * overlap (different carer), same-carer hard conflict, and cross-household
 * busy blocks.
 */
import type { AnonymisedBusyBlock } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  findConflictingBusyBlocks,
  intervalsOverlap,
} from '@/src/domains/timeOff/utils/busyConflict';

export type ExtraShiftWarning = 'past' | 'householdOverlap' | 'busy';

const IGNORED_STATUSES = new Set<string>([
  SHIFT_STATUSES.CANCELLED,
  SHIFT_STATUSES.DECLINED,
]);

function isActiveShift(shift: Shift): boolean {
  return !IGNORED_STATUSES.has(shift.status);
}

/** First overlapping shift assigned to a different carer, if any. */
export function findHouseholdOverlapShift(
  startsAt: string,
  endsAt: string,
  carerId: string,
  shifts: Shift[]
): Shift | null {
  for (const shift of shifts) {
    if (!isActiveShift(shift)) continue;
    if (shift.carer_id === carerId) continue;
    if (intervalsOverlap(startsAt, endsAt, shift.starts_at, shift.ends_at)) {
      return shift;
    }
  }
  return null;
}

export function collectExtraShiftWarnings(params: {
  startsAt: string;
  endsAt: string;
  nowIso: string;
  carerId: string;
  shifts: Shift[];
  busyBlocks: AnonymisedBusyBlock[];
}): {
  sameCarerConflict: Shift | null;
  warnings: ExtraShiftWarning[];
} {
  const { startsAt, endsAt, nowIso, carerId, shifts, busyBlocks } = params;
  const warnings: ExtraShiftWarning[] = [];

  // Instants, not text — see `intervalsOverlap`'s note. Both sides happen to
  // be `Z`-spelled today; comparing them as strings makes that a silent
  // requirement of whoever calls this next.
  if (Date.parse(startsAt) < Date.parse(nowIso)) {
    warnings.push('past');
  }

  let sameCarerConflict: Shift | null = null;
  for (const shift of shifts) {
    if (!isActiveShift(shift)) continue;
    if (shift.carer_id !== carerId) continue;
    if (intervalsOverlap(startsAt, endsAt, shift.starts_at, shift.ends_at)) {
      sameCarerConflict = shift;
      break;
    }
  }

  if (
    !sameCarerConflict &&
    findHouseholdOverlapShift(startsAt, endsAt, carerId, shifts)
  ) {
    warnings.push('householdOverlap');
  }

  if (findConflictingBusyBlocks(startsAt, endsAt, busyBlocks).length > 0) {
    warnings.push('busy');
  }

  return { sameCarerConflict, warnings };
}

/** Highest-priority advisory warning for the confirm dialog title. */
export function primaryExtraShiftWarning(
  warnings: ExtraShiftWarning[]
): ExtraShiftWarning | null {
  if (warnings.includes('past')) return 'past';
  if (warnings.includes('householdOverlap')) return 'householdOverlap';
  if (warnings.includes('busy')) return 'busy';
  return null;
}

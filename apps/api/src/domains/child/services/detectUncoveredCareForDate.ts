/**
 * Impure uncovered-care detection for one household local date — fetches
 * shifts, commitments, and closures, maps them to the shared pure input
 * shapes, and delegates to `uncoveredCareService.raiseUncoveredOnce`.
 *
 * Extracted from `shiftQueryService.raiseUncoveredCare` so event-driven
 * write paths can share one fetch/map/call implementation.
 *
 * @module domains/child/services/detectUncoveredCareForDate
 */
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type {
  ClosureInput,
  CoveredShiftInput,
  NeedWindowInput,
} from '@steadily-nanny/shared-types/uncoveredCare';
import { logger } from '../../../middlewares/logger';
import { HouseholdClosureRepository } from '../../availability/repositories/householdClosureRepository';
import type { HouseholdClosure } from '../../availability/types';
import { HouseholdRepository } from '../../household';
import type { ShiftWithChildren } from '../../shift/repositories/shiftRepository';
import { ShiftRepository } from '../../shift/repositories/shiftRepository';
import { ChildCommitmentRepository } from '../repositories/childCommitmentRepository';
import {
  type RaiseUncoveredResult,
  type UncoveredCause,
  uncoveredCareService,
} from './uncoveredCareService';

export interface DetectUncoveredCareArgs {
  householdId: string;
  localDate: string;
  cause: UncoveredCause;
  actorId?: string | null;
  excludeUserId?: string;
}

/** DB row -> the pure input shape `computeUncovered` consumes. */
export function toCoveredShift(shift: ShiftWithChildren): CoveredShiftInput {
  return {
    id: shift.id,
    startsAt: shift.starts_at,
    endsAt: shift.ends_at,
    status: shift.status,
    children: (shift.shift_children ?? []).map(child => ({
      childId: child.child_id,
      startsAt: child.starts_at,
      endsAt: child.ends_at,
    })),
  };
}

/** DB row -> the pure input shape `computeUncovered` consumes. */
export function toNeedWindow(commitment: ChildCommitment): NeedWindowInput {
  return {
    id: commitment.id,
    childId: commitment.child_id,
    rrule: commitment.rrule,
    startTime: commitment.start_time,
    endTime: commitment.end_time,
    startsOn: commitment.starts_on,
    endsOn: commitment.ends_on,
    exdates: commitment.exdates,
  };
}

function closuresOverlappingLocalDate(
  closures: readonly HouseholdClosure[],
  localDate: string,
  timezone: string
): ClosureInput[] {
  const dayStart = zonedWallTimeToUtcMillis(localDate, '00:00:00', timezone);
  const dayEnd = zonedWallTimeToUtcMillis(
    nextCalendarDate(localDate),
    '00:00:00',
    timezone
  );
  return closures
    .filter(
      c => Date.parse(c.starts_at) < dayEnd && Date.parse(c.ends_at) > dayStart
    )
    .map(c => ({ startsAt: c.starts_at, endsAt: c.ends_at }));
}

function nextCalendarDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function zonedWallTimeToUtcMillis(
  dateStr: string,
  timeStr: string,
  timeZone: string
): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh = 0, mi = 0, ss = 0] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh, mi, ss);
  const offset1 = offsetMinutesAt(guess, timeZone);
  let utc = guess - offset1 * 60_000;
  const offset2 = offsetMinutesAt(utc, timeZone);
  if (offset2 !== offset1) {
    utc = guess - offset2 * 60_000;
  }
  return utc;
}

function offsetMinutesAt(utcMillis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMillis));
  const get = (type: string): number =>
    Number(parts.find(p => p.type === type)?.value ?? '0');
  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return (localAsUtc - utcMillis) / 60_000;
}

export interface UncoveredComputeInputs {
  timezone: string;
  shifts: CoveredShiftInput[];
  needWindows: NeedWindowInput[];
  closures: ClosureInput[];
}

/**
 * Fetch + map the shift/commitment/closure rows `computeUncovered` needs for
 * one household local date. `null` means the household is gone. Extracted so
 * the digest job can share this one fetch/map path rather than growing a
 * second — both callers then delegate to the same `computeUncovered` import.
 */
export async function loadUncoveredInputsForDate(
  householdId: string,
  localDate: string,
  deps: {
    householdRepo?: HouseholdRepository;
    shiftRepo?: ShiftRepository;
    commitmentRepo?: ChildCommitmentRepository;
    closureRepo?: HouseholdClosureRepository;
  } = {}
): Promise<UncoveredComputeInputs | null> {
  const householdRepo = deps.householdRepo ?? new HouseholdRepository();
  const shiftRepo = deps.shiftRepo ?? new ShiftRepository();
  const commitmentRepo = deps.commitmentRepo ?? new ChildCommitmentRepository();
  const closureRepo = deps.closureRepo ?? new HouseholdClosureRepository();

  const household = await householdRepo.findById(householdId);
  if (!household) {
    return null;
  }

  const [shifts, commitments, allClosures] = await Promise.all([
    shiftRepo.findByHouseholdAndLocalDate(householdId, localDate),
    commitmentRepo.findByHouseholdId(householdId),
    closureRepo.listByHousehold(householdId),
  ]);
  const closures = closuresOverlappingLocalDate(
    allClosures,
    localDate,
    household.timezone
  );

  return {
    timezone: household.timezone,
    shifts: shifts.map(toCoveredShift),
    needWindows: commitments.map(toNeedWindow),
    closures,
  };
}

/**
 * Run uncovered-care detection for one household local date. `inserted` is
 * every window genuinely created this call; `pushed` is the subset a push
 * went out for (see `uncoveredCareService.raiseUncoveredOnce`).
 */
export async function detectUncoveredCareForDate(
  args: DetectUncoveredCareArgs,
  deps: {
    householdRepo?: HouseholdRepository;
    shiftRepo?: ShiftRepository;
    commitmentRepo?: ChildCommitmentRepository;
    closureRepo?: HouseholdClosureRepository;
  } = {}
): Promise<RaiseUncoveredResult> {
  const inputs = await loadUncoveredInputsForDate(
    args.householdId,
    args.localDate,
    deps
  );
  if (!inputs) {
    return { inserted: [], pushed: [] };
  }

  return uncoveredCareService.raiseUncoveredOnce({
    householdId: args.householdId,
    localDate: args.localDate,
    timezone: inputs.timezone,
    shifts: inputs.shifts,
    needWindows: inputs.needWindows,
    closures: inputs.closures,
    cause: args.cause,
    actorId: args.actorId,
    excludeUserId: args.excludeUserId,
  });
}

/**
 * Fire-and-forget wrapper — logs and swallows failures so a detection error
 * never fails the write that triggered it.
 */
export function detectUncoveredCareBestEffort(
  args: DetectUncoveredCareArgs
): void {
  void detectUncoveredCareForDate(args).catch(error => {
    logger.error('Uncovered-care detection failed', {
      householdId: args.householdId,
      localDate: args.localDate,
      cause: args.cause,
      error,
    });
  });
}

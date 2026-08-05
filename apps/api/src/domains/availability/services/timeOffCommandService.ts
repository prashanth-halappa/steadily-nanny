/**
 * Time-off command service (CQRS-lite: writes).
 *
 * On create/update: scan the carer's confirmed shifts overlapping the
 * range and push each affected household's parents with THAT household's
 * count only — never leak cross-family totals or ids. Push failures never
 * fail the write.
 *
 * @module domains/availability/services/timeOffCommandService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { ValidationError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { notifyHouseholdParents, type PushPayload } from '../../notification';
import { ptoCommandService } from '../../pay/services/ptoCommandService';
import { CarerTimeOffRepository } from '../repositories/carerTimeOffRepository';
import {
  type OverlappingBookedShift,
  OverlappingShiftRepository,
} from '../repositories/overlappingShiftRepository';
import { CARER_TIME_OFF_STATUSES } from '../schemas';
import type {
  CarerTimeOff,
  CarerTimeOffMutationResponse,
  CreateCarerTimeOffInput,
  UpdateCarerTimeOffInput,
} from '../types';
import {
  type TimeOffQueryService,
  timeOffQueryService,
} from './timeOffQueryService';

/** Narrow contract for the overlapping-shift lookup (test seam). */
export interface OverlappingShiftLookup {
  listConfirmedForCarerInRange(
    carerId: string,
    from: string,
    to: string
  ): Promise<OverlappingBookedShift[]>;
}

/** Fire-and-forget parent notify — injectable for tests. */
export type NotifyHouseholdParentsFn = (
  householdId: string,
  payload: PushPayload
) => void;

/**
 * Reverse any paid-PTO usage recorded against a cancelled time off —
 * injectable for tests. Fire-and-forget at the call site.
 */
export type ReconcilePtoUsageFn = (timeOffId: string) => Promise<void>;

export class TimeOffCommandService {
  constructor(
    private readonly timeOffRepo: CarerTimeOffRepository = new CarerTimeOffRepository(),
    private readonly queries: TimeOffQueryService = timeOffQueryService,
    private readonly overlapRepo: OverlappingShiftLookup = new OverlappingShiftRepository(),
    private readonly notifyParents: NotifyHouseholdParentsFn = notifyHouseholdParents,
    // Imported by concrete path, not through the pay barrel: the pay domain
    // imports this domain's repositories, so barrel-to-barrel would cycle.
    // Same convention as the timesheet domain's weekEarningsService import.
    private readonly reconcilePtoUsage: ReconcilePtoUsageFn = timeOffId =>
      ptoCommandService.reconcileCancelledTimeOff(timeOffId)
  ) {}

  /** Create a time-off row for the caller; scan + notify on overlaps. */
  async create(
    userId: string,
    input: CreateCarerTimeOffInput
  ): Promise<CarerTimeOffMutationResponse> {
    const carer_time_off = await this.timeOffRepo.create({
      ...input,
      user_id: userId,
    });
    const affected_shift_count = await this.safeScanAndNotify(
      userId,
      carer_time_off.starts_at,
      carer_time_off.ends_at
    );
    return { carer_time_off, affected_shift_count };
  }

  /**
   * Cancel (soft-delete) the caller's OWN time-off row. Verifies ownership
   * first via `queries.getOwned` (throws `TimeOffNotFoundError` for both
   * "missing" and "not yours"), then sets `status = 'cancelled'` — NEVER a
   * hard delete, since the partial index `carer_time_off_user_range_idx
   * ... where status <> 'cancelled'` implies cancelled rows persist.
   *
   * IDEMPOTENT (Phase 3/4 review, BLOCKER 1). `getOwned` checks ownership
   * only, so cancelling an already-cancelled time off used to "succeed" and
   * re-run everything below it. `cancelById` is now conditional on the row
   * not already being cancelled and returns `null` when it changed nothing;
   * that `null` is the signal to skip the reconciliation entirely, because
   * the row was already cancelled and whatever reversal it needed has
   * already happened. The caller still gets a success and the row as it
   * stands — a second DELETE is not an error.
   */
  async cancel(userId: string, timeOffId: string): Promise<CarerTimeOff> {
    const existing = await this.queries.getOwned(userId, timeOffId);
    const cancelled = await this.timeOffRepo.cancelById(timeOffId);
    if (!cancelled) {
      // Already cancelled — nothing transitioned, so nothing to reconcile.
      return existing;
    }

    // A household may already have marked this time off as paid PTO. Leaving
    // that usage row behind would keep a paid day the carer is no longer
    // taking, and the balance drifts silently — so reverse it with an
    // append-only adjustment (never a delete; the ledger is evidence).
    //
    // Fire-and-forget on purpose: the cancellation is the carer's own, and a
    // bookkeeping failure downstream must never leave her unable to cancel.
    // Retries are therefore guaranteed, and TWO things make one safe: the
    // conditional cancel above means a retried DELETE never reaches this
    // line at all, and `reconcileCancelledTimeOff` itself writes only the
    // difference between what a household has paid and what it has already
    // reversed — a second run against a reversed ledger nets to zero and
    // writes nothing.
    void this.reconcilePtoUsage(timeOffId).catch((error: unknown) => {
      logger.error('Failed to reconcile PTO usage after time-off cancel', {
        timeOffId,
        error,
      });
    });

    return cancelled;
  }

  /**
   * Edit dates/message on the caller's OWN active time-off row. Verifies
   * ownership via `queries.getOwned` (throws `TimeOffNotFoundError` for both
   * "missing" and "not yours"), rejects cancelled rows, validates the
   * RESULTING date range, and never accepts `status` — cancel stays on DELETE.
   * Re-scans overlaps on the effective range after the write.
   */
  async update(
    userId: string,
    timeOffId: string,
    input: UpdateCarerTimeOffInput
  ): Promise<CarerTimeOffMutationResponse> {
    const row = await this.queries.getOwned(userId, timeOffId);

    if (row.status === CARER_TIME_OFF_STATUSES.CANCELLED) {
      throw new ValidationError(
        'Cannot edit cancelled time off',
        'TIME_OFF_CANCELLED',
        400,
        { timeOffId }
      );
    }

    if (Date.parse(row.ends_at) <= Date.now()) {
      throw new ValidationError(
        'Cannot edit past time off',
        'TIME_OFF_PAST',
        400,
        { timeOffId }
      );
    }

    if (input.status !== undefined) {
      throw new ValidationError(
        'Use DELETE to cancel time off',
        'TIME_OFF_STATUS_NOT_PATCHABLE',
        400,
        { timeOffId }
      );
    }

    const effectiveStarts = input.starts_at ?? row.starts_at;
    const effectiveEnds = input.ends_at ?? row.ends_at;
    if (Date.parse(effectiveEnds) <= Date.parse(effectiveStarts)) {
      throw new ValidationError(
        'ends_at must be after starts_at',
        'INVALID_TIME_OFF_RANGE',
        400,
        { timeOffId, starts_at: effectiveStarts, ends_at: effectiveEnds }
      );
    }

    const carer_time_off = await this.timeOffRepo.update(timeOffId, {
      ...input,
      sequence: row.sequence + 1,
    });
    const affected_shift_count = await this.safeScanAndNotify(
      userId,
      carer_time_off.starts_at,
      carer_time_off.ends_at
    );
    return { carer_time_off, affected_shift_count };
  }

  /**
   * Scan failures must not 500 a successful write — return 0 (best-effort
   * count) and log. Push errors inside the scan are also swallowed.
   */
  private async safeScanAndNotify(
    carerId: string,
    startsAt: string,
    endsAt: string
  ): Promise<number> {
    try {
      return await this.scanAndNotify(carerId, startsAt, endsAt);
    } catch (error) {
      logger.error('Time-off overlap scan failed after write', {
        carerId,
        startsAt,
        endsAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Group overlapping confirmed shifts by household, push each household
   * only its own count, return the total. Push errors are swallowed.
   */
  private async scanAndNotify(
    carerId: string,
    startsAt: string,
    endsAt: string
  ): Promise<number> {
    const shifts = await this.overlapRepo.listConfirmedForCarerInRange(
      carerId,
      startsAt,
      endsAt
    );
    if (shifts.length === 0) return 0;

    const counts = new Map<string, number>();
    for (const shift of shifts) {
      counts.set(shift.household_id, (counts.get(shift.household_id) ?? 0) + 1);
    }

    for (const [householdId, count] of counts) {
      const payload: PushPayload = {
        title: 'Carer time off overlaps shifts',
        body:
          count === 1
            ? 'Your carer has taken time off that overlaps 1 booked shift.'
            : `Your carer has taken time off that overlaps ${count} booked shifts.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT,
          householdId,
          affectedShiftCount: count,
        },
      };
      try {
        this.notifyParents(householdId, payload);
      } catch {
        // Fire-and-forget: a sync throw must never fail the time-off write.
      }
    }

    return shifts.length;
  }
}

// Singleton for controllers that don't need DI.
export const timeOffCommandService = new TimeOffCommandService();

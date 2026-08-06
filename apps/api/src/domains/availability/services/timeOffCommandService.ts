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

import { HOUSEHOLD_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { ExternalServiceError, ValidationError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { HouseholdMemberRepository } from '../../household';
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
 * injectable for tests. AWAITED at the call site (F-B9-2): it moves money,
 * so a cancel that returns before it lands is a cancel that lied.
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
      ptoCommandService.reconcileCancelledTimeOff(timeOffId),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
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
    this.notifyTimeOffRequested(userId);
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
   * the caller still gets a success and the row as it stands — a second
   * DELETE is not an error.
   *
   * THE PTO REVERSAL IS PART OF THE CANCEL, NOT A SIDE EFFECT (F-B9-2). A
   * household may already have marked this time off as paid PTO. Leaving
   * that usage row behind keeps a paid day the carer is no longer taking, so
   * it is reversed with an append-only adjustment (never a delete; the
   * ledger is evidence). That reversal used to be fire-and-forget, on the
   * reasoning that a bookkeeping failure must never leave her unable to
   * cancel — and the consequence was worse than the problem: a failed
   * reversal returned 200, left real money owed on the ledger, and could
   * NEVER be repaired, because the conditional cancel above made a retried
   * DELETE short-circuit before ever reaching it.
   *
   * So it is awaited, its failure is surfaced as a retryable 503, and it
   * runs on EVERY cancel including the ones that transitioned nothing —
   * which is precisely what lets the retry the 503 asks for finish the job.
   * Running it again is free: `reconcileCancelledTimeOff` writes only the
   * difference between what a household has paid and what it has already
   * reversed, so a second run against a reversed ledger writes nothing.
   */
  async cancel(userId: string, timeOffId: string): Promise<CarerTimeOff> {
    const existing = await this.queries.getOwned(userId, timeOffId);
    const cancelled = await this.timeOffRepo.cancelById(timeOffId);

    try {
      await this.reconcilePtoUsage(timeOffId);
    } catch (error) {
      logger.error('Failed to reconcile PTO usage after time-off cancel', {
        timeOffId,
        error: error instanceof Error ? error.message : String(error),
      });
      // The row IS cancelled; only the ledger correction failed. Retrying
      // the DELETE is the repair, and the reconciliation above is idempotent,
      // so the client is told to do exactly that.
      throw new ExternalServiceError(
        'Time off was cancelled but its paid-PTO reversal did not complete — please try again',
        'PTO_RECONCILE_FAILED',
        503,
        { timeOffId }
      );
    }

    return cancelled ?? existing;
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

  /**
   * Parents of every household where the carer is an active nanny need to
   * know about a new request — time off is person-scoped, so a multi-family
   * carer fans out one push per household. Complements the conflict push when
   * shifts overlap; both are intentional (request vs overlap detail).
   */
  private notifyTimeOffRequested(carerId: string): void {
    void this.memberRepo
      .listActiveByUser(carerId)
      .then(memberships => {
        const householdIds = new Set(
          memberships
            .filter(m => m.role === HOUSEHOLD_ROLES.NANNY)
            .map(m => m.household_id)
        );
        for (const householdId of householdIds) {
          const payload: PushPayload = {
            title: 'Time off requested',
            body: 'Your nanny has requested time off — open Time off to review.',
            data: {
              type: PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED,
              householdId,
            },
          };
          try {
            this.notifyParents(householdId, payload);
          } catch {
            // notifyParents is sync fire-and-forget; swallow any unexpected throw
          }
        }
      })
      .catch(error => {
        logger.error('Failed to notify parents of time-off request', {
          carerId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

// Singleton for controllers that don't need DI.
export const timeOffCommandService = new TimeOffCommandService();

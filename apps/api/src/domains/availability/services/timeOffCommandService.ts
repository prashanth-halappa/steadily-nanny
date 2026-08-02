/**
 * Time-off command service (CQRS-lite: writes).
 *
 * @module domains/availability/services/timeOffCommandService
 */
import { ValidationError } from '../../../errors';
import { CarerTimeOffRepository } from '../repositories/carerTimeOffRepository';
import { CARER_TIME_OFF_STATUSES } from '../schemas';
import type {
  CarerTimeOff,
  CreateCarerTimeOffInput,
  UpdateCarerTimeOffInput,
} from '../types';
import {
  type TimeOffQueryService,
  timeOffQueryService,
} from './timeOffQueryService';

export class TimeOffCommandService {
  constructor(
    private readonly timeOffRepo: CarerTimeOffRepository = new CarerTimeOffRepository(),
    private readonly queries: TimeOffQueryService = timeOffQueryService
  ) {}

  /** Create a time-off row for the caller. */
  async create(
    userId: string,
    input: CreateCarerTimeOffInput
  ): Promise<CarerTimeOff> {
    return this.timeOffRepo.create({ ...input, user_id: userId });
  }

  /**
   * Cancel (soft-delete) the caller's OWN time-off row. Verifies ownership
   * first via `queries.getOwned` (throws `TimeOffNotFoundError` for both
   * "missing" and "not yours"), then sets `status = 'cancelled'` — NEVER a
   * hard delete, since the partial index `carer_time_off_user_range_idx
   * ... where status <> 'cancelled'` implies cancelled rows persist.
   */
  async cancel(userId: string, timeOffId: string): Promise<CarerTimeOff> {
    await this.queries.getOwned(userId, timeOffId);
    return this.timeOffRepo.cancelById(timeOffId);
  }

  /**
   * Edit dates/message on the caller's OWN active time-off row. Verifies
   * ownership via `queries.getOwned` (throws `TimeOffNotFoundError` for both
   * "missing" and "not yours"), rejects cancelled rows, validates the
   * RESULTING date range, and never accepts `status` — cancel stays on DELETE.
   */
  async update(
    userId: string,
    timeOffId: string,
    input: UpdateCarerTimeOffInput
  ): Promise<CarerTimeOff> {
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

    return this.timeOffRepo.update(timeOffId, {
      ...input,
      sequence: row.sequence + 1,
    });
  }
}

// Singleton for controllers that don't need DI.
export const timeOffCommandService = new TimeOffCommandService();

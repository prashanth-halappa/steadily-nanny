/**
 * Time-off command service (CQRS-lite: writes).
 *
 * @module domains/availability/services/timeOffCommandService
 */
import { CarerTimeOffRepository } from '../repositories/carerTimeOffRepository';
import type { CarerTimeOff, CreateCarerTimeOffInput } from '../types';
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
}

// Singleton for controllers that don't need DI.
export const timeOffCommandService = new TimeOffCommandService();

/**
 * Time-off query service (CQRS-lite: reads only).
 *
 * @module domains/availability/services/timeOffQueryService
 */
import { TimeOffNotFoundError } from '../errors/availabilityErrors';
import { CarerTimeOffRepository } from '../repositories/carerTimeOffRepository';
import type { CarerTimeOff } from '../types';

export class TimeOffQueryService {
  constructor(
    private readonly timeOffRepo: CarerTimeOffRepository = new CarerTimeOffRepository()
  ) {}

  /** List the caller's own time-off rows. */
  async listOwn(userId: string): Promise<CarerTimeOff[]> {
    return this.timeOffRepo.listByUserId(userId);
  }

  /**
   * Fetch one time-off row, enforcing ownership. Throws
   * `TimeOffNotFoundError` for BOTH "doesn't exist" and "exists but isn't
   * yours" — the SAME error for both, mirroring
   * `HouseholdQueryService.getOwned` — so a caller can never distinguish the
   * two by probing ids. This is the `lookup` the ownership middleware calls
   * on `DELETE /time-off/:id`.
   */
  async getOwned(userId: string, timeOffId: string): Promise<CarerTimeOff> {
    const row = await this.timeOffRepo.findById(timeOffId);
    if (!row || row.user_id !== userId) {
      throw new TimeOffNotFoundError(timeOffId);
    }
    return row;
  }
}

// Singleton for controllers/routes that don't need DI.
export const timeOffQueryService = new TimeOffQueryService();

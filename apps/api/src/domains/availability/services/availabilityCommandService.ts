/**
 * Availability command service (CQRS-lite: writes).
 *
 * @module domains/availability/services/availabilityCommandService
 */
import { CarerAvailabilityRepository } from '../repositories/carerAvailabilityRepository';
import type { CarerAvailability, CreateCarerAvailabilityInput } from '../types';

export class AvailabilityCommandService {
  constructor(
    private readonly availabilityRepo: CarerAvailabilityRepository = new CarerAvailabilityRepository()
  ) {}

  /**
   * Upsert one weekday row for the caller, keyed on the DB's unique
   * `(user_id, weekday)` index. The PUT body always represents exactly one
   * weekday (`CreateCarerAvailabilitySchema` requires `weekday`), so this is
   * both the create and the full-replace path for that weekday.
   */
  async upsertWeekday(
    userId: string,
    input: CreateCarerAvailabilityInput
  ): Promise<CarerAvailability> {
    const { weekday, ...rest } = input;
    return this.availabilityRepo.upsertForWeekday(userId, weekday, rest);
  }
}

// Singleton for controllers that don't need DI.
export const availabilityCommandService = new AvailabilityCommandService();

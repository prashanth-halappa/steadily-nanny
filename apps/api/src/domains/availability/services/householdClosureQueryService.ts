/**
 * Household-closure query service (CQRS-lite: reads). Any active household
 * member may list/read — carers need to see "we're away". Writes are
 * parent-gated in the command service.
 *
 * @module domains/availability/services/householdClosureQueryService
 */
import {
  type HouseholdQueryService,
  householdQueryService,
} from '../../household/services/householdQueryService';
import { HouseholdClosureNotFoundError } from '../errors/availabilityErrors';
import { HouseholdClosureRepository } from '../repositories/householdClosureRepository';
import type { HouseholdClosure } from '../types';

export class HouseholdClosureQueryService {
  constructor(
    private readonly repo: HouseholdClosureRepository = new HouseholdClosureRepository(),
    private readonly households: HouseholdQueryService = householdQueryService
  ) {}

  /** List closures for a household. Caller must be an active member. */
  async listForHousehold(
    userId: string,
    householdId: string
  ): Promise<HouseholdClosure[]> {
    await this.households.getMembership(userId, householdId);
    return this.repo.listByHousehold(householdId);
  }

  /**
   * Fetch one closure, enforcing membership + household match. Throws
   * `HouseholdClosureNotFoundError` for missing / wrong-household alike.
   */
  async getOwned(
    userId: string,
    householdId: string,
    closureId: string
  ): Promise<HouseholdClosure> {
    await this.households.getMembership(userId, householdId);
    const row = await this.repo.findById(closureId);
    if (!row || row.household_id !== householdId) {
      throw new HouseholdClosureNotFoundError(closureId);
    }
    return row;
  }
}

export const householdClosureQueryService = new HouseholdClosureQueryService();

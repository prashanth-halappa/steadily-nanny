/**
 * Child query service (CQRS-lite: reads only). Any active household member
 * may read (nanny/helper included — a carer cannot do the job without
 * knowing the child's routine) — only writes are parent/owner-gated (see
 * childCommandService). Membership/role checks delegate to the household
 * domain's query service.
 *
 * @module domains/child/services/childQueryService
 */
import {
  type HouseholdQueryService,
  householdQueryService,
} from '../../household/services/householdQueryService';
import { ChildNotFoundError } from '../errors/childErrors';
import { ChildRepository } from '../repositories/childRepository';
import type { Child } from '../types';

export class ChildQueryService {
  constructor(
    private readonly repo: ChildRepository = new ChildRepository(),
    private readonly households: HouseholdQueryService = householdQueryService
  ) {}

  /** List a household's active (non-archived) children. Caller must be a member. */
  async listForHousehold(
    userId: string,
    householdId: string
  ): Promise<Child[]> {
    await this.households.getMembership(userId, householdId);
    return this.repo.findActiveByHousehold(householdId);
  }

  /**
   * Fetch one child, enforcing household membership. Archived children still
   * resolve here (soft delete, not gone) — only the list endpoint hides them.
   * Throws ChildNotFoundError uniformly for "missing", "belongs to a
   * different household than the URL says", and "caller is not a member" —
   * no existence leak.
   */
  async getOwned(
    userId: string,
    householdId: string,
    childId: string
  ): Promise<Child> {
    await this.households.getMembership(userId, householdId);
    const child = await this.repo.findById(childId);
    if (!child || child.household_id !== householdId) {
      throw new ChildNotFoundError(childId);
    }
    return child;
  }
}

// Singleton for controllers/routes that don't need DI.
export const childQueryService = new ChildQueryService();

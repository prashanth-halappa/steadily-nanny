/**
 * Child command service (CQRS-lite: writes). Owner/parent only — nannies and
 * helpers read but never create/edit/archive a child. The role check
 * delegates to the household domain's membership row, one line at the top of
 * each method (same pattern as householdCommandService).
 *
 * @module domains/child/services/childCommandService
 */
import { NotAHouseholdParentError } from '../../household/errors/householdErrors';
import { HOUSEHOLD_ROLES } from '../../household/schemas';
import {
  type HouseholdQueryService,
  householdQueryService,
} from '../../household/services/householdQueryService';
import { ChildRepository } from '../repositories/childRepository';
import type { Child, CreateChildInput, UpdateChildInput } from '../types';
import { type ChildQueryService, childQueryService } from './childQueryService';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

export class ChildCommandService {
  constructor(
    private readonly repo: ChildRepository = new ChildRepository(),
    private readonly households: HouseholdQueryService = householdQueryService,
    private readonly queries: ChildQueryService = childQueryService
  ) {}

  /** Create a child in a household. Owner/parent only. */
  async create(
    userId: string,
    householdId: string,
    input: CreateChildInput
  ): Promise<Child> {
    await this.assertWriteRole(userId, householdId);
    return this.repo.create({ ...input, household_id: householdId });
  }

  /** Update a child's mutable fields. Owner/parent only. */
  async update(
    userId: string,
    householdId: string,
    childId: string,
    input: UpdateChildInput
  ): Promise<Child> {
    await this.assertWriteRole(userId, householdId);
    await this.queries.getOwned(userId, householdId, childId);
    return this.repo.update(childId, input);
  }

  /**
   * Soft delete — archives rather than removing the row, so the child still
   * resolves on a past timesheet. Owner/parent only.
   */
  async archive(
    userId: string,
    householdId: string,
    childId: string
  ): Promise<Child> {
    await this.assertWriteRole(userId, householdId);
    await this.queries.getOwned(userId, householdId, childId);
    return this.repo.archive(childId);
  }

  private async assertWriteRole(
    userId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.households.getMembership(userId, householdId);
    if (!WRITE_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(householdId, membership.role);
    }
  }
}

// Singleton for controllers that don't need DI.
export const childCommandService = new ChildCommandService();

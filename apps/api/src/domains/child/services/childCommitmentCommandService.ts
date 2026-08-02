/**
 * Child-commitment command service (CQRS-lite: writes). Owner/parent only —
 * nannies and helpers read but never create/edit/delete a commitment, same
 * WRITE_ROLES gate as `childCommandService`. `create` additionally confirms
 * the child belongs to the household named in the URL (via
 * `childQueryService.getOwned`); `update`/`remove` resolve the commitment
 * first via `childCommitmentQueryService.getOwned` (id-only — the flat
 * `/commitments/:commitmentId` routes carry no household id to check
 * against) and then assert the role against ITS household.
 *
 * @module domains/child/services/childCommitmentCommandService
 */
import { NotAHouseholdParentError } from '../../household/errors/householdErrors';
import { HOUSEHOLD_ROLES } from '../../household/schemas';
import {
  type HouseholdQueryService,
  householdQueryService,
} from '../../household/services/householdQueryService';
import { ChildCommitmentRepository } from '../repositories/childCommitmentRepository';
import type {
  ChildCommitment,
  CreateChildCommitmentInput,
  UpdateChildCommitmentInput,
} from '../types';
import {
  type ChildCommitmentQueryService,
  childCommitmentQueryService,
} from './childCommitmentQueryService';
import { type ChildQueryService, childQueryService } from './childQueryService';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

export class ChildCommitmentCommandService {
  constructor(
    private readonly repo: ChildCommitmentRepository = new ChildCommitmentRepository(),
    private readonly households: HouseholdQueryService = householdQueryService,
    private readonly children: ChildQueryService = childQueryService,
    private readonly queries: ChildCommitmentQueryService = childCommitmentQueryService
  ) {}

  /** Create a commitment for a child. Owner/parent only. */
  async create(
    userId: string,
    householdId: string,
    childId: string,
    input: CreateChildCommitmentInput
  ): Promise<ChildCommitment> {
    await this.assertWriteRole(userId, householdId);
    await this.children.getOwned(userId, householdId, childId);
    return this.repo.create({
      ...input,
      child_id: childId,
      household_id: householdId,
    });
  }

  /** Update a commitment's mutable fields. Owner/parent only. */
  async update(
    userId: string,
    commitmentId: string,
    input: UpdateChildCommitmentInput
  ): Promise<ChildCommitment> {
    const commitment = await this.queries.getOwned(userId, commitmentId);
    await this.assertWriteRole(userId, commitment.household_id);
    return this.repo.update(commitmentId, input);
  }

  /**
   * Hard delete — commitments have no soft-delete concept (unlike
   * `children`'s `archived_at`). Owner/parent only.
   */
  async remove(userId: string, commitmentId: string): Promise<void> {
    const commitment = await this.queries.getOwned(userId, commitmentId);
    await this.assertWriteRole(userId, commitment.household_id);
    await this.repo.delete(commitmentId);
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
export const childCommitmentCommandService =
  new ChildCommitmentCommandService();

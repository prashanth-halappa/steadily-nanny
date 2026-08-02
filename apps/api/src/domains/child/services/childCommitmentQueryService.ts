/**
 * Child-commitment query service (CQRS-lite: reads only). Same "any active
 * member can read" rule as `childQueryService` — a nanny needs to see
 * "preschool 9-12" to know when they ARE and ARE NOT covering, even though
 * only a parent may write one (see `childCommitmentCommandService`).
 *
 * @module domains/child/services/childCommitmentQueryService
 */
import { HouseholdMemberRepository } from '../../household';
import { ChildCommitmentNotFoundError } from '../errors/childErrors';
import { ChildCommitmentRepository } from '../repositories/childCommitmentRepository';
import type { ChildCommitment } from '../types';
import { type ChildQueryService, childQueryService } from './childQueryService';

export class ChildCommitmentQueryService {
  constructor(
    private readonly repo: ChildCommitmentRepository = new ChildCommitmentRepository(),
    private readonly children: ChildQueryService = childQueryService,
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /**
   * List one child's commitments. Delegates the membership + "child belongs
   * to this household" check to `childQueryService.getOwned` rather than
   * re-implementing it — a commitment list is only ever reached through its
   * child.
   */
  async listForChild(
    userId: string,
    householdId: string,
    childId: string
  ): Promise<ChildCommitment[]> {
    await this.children.getOwned(userId, householdId, childId);
    return this.repo.findByChildId(childId);
  }

  /**
   * Fetch one commitment by id alone — the flat `/commitments/:commitmentId`
   * routes carry no household id in the URL to validate against, so
   * membership is checked against the commitment's OWN `household_id`
   * instead (same shape as `shiftQueryService.getOwned`). Throws
   * ChildCommitmentNotFoundError uniformly for "missing" and "caller is not
   * a member" — no existence leak.
   */
  async getOwned(
    userId: string,
    commitmentId: string
  ): Promise<ChildCommitment> {
    const commitment = await this.repo.findById(commitmentId);
    if (!commitment) {
      throw new ChildCommitmentNotFoundError(commitmentId);
    }
    const membership = await this.memberRepo.findActiveMembership(
      commitment.household_id,
      userId
    );
    if (!membership) {
      throw new ChildCommitmentNotFoundError(commitmentId);
    }
    return commitment;
  }
}

// Singleton for controllers/routes that don't need DI.
export const childCommitmentQueryService = new ChildCommitmentQueryService();

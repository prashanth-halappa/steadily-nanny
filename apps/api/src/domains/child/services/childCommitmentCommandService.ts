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
import { HouseholdRepository } from '../../household/repositories/householdRepository';
import { HOUSEHOLD_ROLES } from '../../household/schemas';
import {
  type HouseholdQueryService,
  householdQueryService,
} from '../../household/services/householdQueryService';
import { addDays } from '../../pay/utils/localDateSpan';
import { localDateOf } from '../../timesheet/utils/weekStart';
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
import { detectUncoveredCareBestEffort } from './detectUncoveredCareForDate';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

export class ChildCommitmentCommandService {
  constructor(
    private readonly repo: ChildCommitmentRepository = new ChildCommitmentRepository(),
    private readonly households: HouseholdQueryService = householdQueryService,
    private readonly children: ChildQueryService = childQueryService,
    private readonly queries: ChildCommitmentQueryService = childCommitmentQueryService,
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository()
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
    const commitment = await this.repo.create({
      ...input,
      child_id: childId,
      household_id: householdId,
    });
    this.detectNeedsAddedBestEffort(householdId, userId);
    return commitment;
  }

  /** Update a commitment's mutable fields. Owner/parent only. */
  async update(
    userId: string,
    commitmentId: string,
    input: UpdateChildCommitmentInput
  ): Promise<ChildCommitment> {
    const commitment = await this.queries.getOwned(userId, commitmentId);
    await this.assertWriteRole(userId, commitment.household_id);
    const updated = await this.repo.update(commitmentId, input);
    this.detectNeedsAddedBestEffort(commitment.household_id, userId);
    return updated;
  }

  /**
   * Hard delete — commitments have no soft-delete concept (unlike
   * `children`'s `archived_at`). Owner/parent only.
   */
  async remove(userId: string, commitmentId: string): Promise<void> {
    const commitment = await this.queries.getOwned(userId, commitmentId);
    await this.assertWriteRole(userId, commitment.household_id);
    await this.repo.delete(commitmentId);
    this.detectNeedsAddedBestEffort(commitment.household_id, userId);
  }

  /** Best-effort detection for the next 72h of local dates after a need write. */
  private detectNeedsAddedBestEffort(
    householdId: string,
    actorId: string
  ): void {
    void this.householdRepo.findById(householdId).then(household => {
      if (!household) {
        return;
      }
      const today = localDateOf(new Date(), household.timezone);
      for (let day = 0; day < 3; day++) {
        try {
          detectUncoveredCareBestEffort({
            householdId,
            localDate: addDays(today, day),
            cause: 'needsAdded',
            actorId,
          });
        } catch {
          // Best-effort only — never fail the commitment write.
        }
      }
    });
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

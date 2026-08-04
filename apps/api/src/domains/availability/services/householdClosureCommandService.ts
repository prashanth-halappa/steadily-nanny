/**
 * Household-closure command service (CQRS-lite: writes). Owner/parent only.
 *
 * @module domains/availability/services/householdClosureCommandService
 */
import { ValidationError } from '../../../errors';
import { NotAHouseholdParentError } from '../../household/errors/householdErrors';
import { HOUSEHOLD_ROLES } from '../../household/schemas';
import {
  type HouseholdQueryService,
  householdQueryService,
} from '../../household/services/householdQueryService';
import { HouseholdClosureRepository } from '../repositories/householdClosureRepository';
import type {
  CreateHouseholdClosureInput,
  HouseholdClosure,
  UpdateHouseholdClosureInput,
} from '../types';
import {
  type HouseholdClosureQueryService,
  householdClosureQueryService,
} from './householdClosureQueryService';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

export class HouseholdClosureCommandService {
  constructor(
    private readonly repo: HouseholdClosureRepository = new HouseholdClosureRepository(),
    private readonly households: HouseholdQueryService = householdQueryService,
    private readonly queries: HouseholdClosureQueryService = householdClosureQueryService
  ) {}

  /** Create a household closure. Owner/parent only. */
  async create(
    userId: string,
    householdId: string,
    input: CreateHouseholdClosureInput
  ): Promise<HouseholdClosure> {
    await this.assertWriteRole(userId, householdId);
    return this.repo.create({
      ...input,
      household_id: householdId,
      created_by: userId,
      message: input.message ?? null,
    });
  }

  /** Update dates/message on a closure. Owner/parent only. */
  async update(
    userId: string,
    householdId: string,
    closureId: string,
    input: UpdateHouseholdClosureInput
  ): Promise<HouseholdClosure> {
    await this.assertWriteRole(userId, householdId);
    const row = await this.queries.getOwned(userId, householdId, closureId);

    const effectiveStarts = input.starts_at ?? row.starts_at;
    const effectiveEnds = input.ends_at ?? row.ends_at;
    if (Date.parse(effectiveEnds) <= Date.parse(effectiveStarts)) {
      throw new ValidationError(
        'ends_at must be after starts_at',
        'INVALID_HOUSEHOLD_CLOSURE_RANGE',
        400,
        { closureId, starts_at: effectiveStarts, ends_at: effectiveEnds }
      );
    }

    return this.repo.update(closureId, input);
  }

  /** Hard-delete a closure. Owner/parent only. */
  async remove(
    userId: string,
    householdId: string,
    closureId: string
  ): Promise<void> {
    await this.assertWriteRole(userId, householdId);
    await this.queries.getOwned(userId, householdId, closureId);
    await this.repo.delete(closureId);
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

export const householdClosureCommandService =
  new HouseholdClosureCommandService();

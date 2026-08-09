/**
 * Household-closure command service (CQRS-lite: writes). Owner/parent only.
 *
 * @module domains/availability/services/householdClosureCommandService
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { ValidationError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { detectUncoveredCareBestEffort } from '../../child/services/detectUncoveredCareForDate';
import { NotAHouseholdParentError } from '../../household/errors/householdErrors';
import { HouseholdMemberRepository } from '../../household/repositories/householdMemberRepository';
import { HOUSEHOLD_ROLES } from '../../household/schemas';
import {
  type HouseholdQueryService,
  householdQueryService,
} from '../../household/services/householdQueryService';
import { notifyUser } from '../../notification';
import { addDays, localDatesCovered } from '../../pay/utils/localDateSpan';
import { localDateOf } from '../../timesheet/utils/weekStart';
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

/** Nanny only — matches schedule/shift carer resolution. */
const CARER_ROLES: ReadonlySet<string> = new Set([HOUSEHOLD_ROLES.NANNY]);

type ClosureChangeVerb = 'added' | 'changed' | 'removed';

const CLOSURE_CHANGE_BODY: Record<ClosureChangeVerb, string> = {
  added:
    'The family added a household closure — open Schedule to see your updated days.',
  changed:
    'A household closure was updated — open Schedule to see your updated days.',
  removed:
    'A household closure was removed — open Schedule to see your updated days.',
};

export class HouseholdClosureCommandService {
  constructor(
    private readonly repo: HouseholdClosureRepository = new HouseholdClosureRepository(),
    private readonly households: HouseholdQueryService = householdQueryService,
    private readonly queries: HouseholdClosureQueryService = householdClosureQueryService,
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /** Create a household closure. Owner/parent only. */
  async create(
    userId: string,
    householdId: string,
    input: CreateHouseholdClosureInput
  ): Promise<HouseholdClosure> {
    await this.assertWriteRole(userId, householdId);
    const closure = await this.repo.create({
      ...input,
      household_id: householdId,
      created_by: userId,
      message: input.message ?? null,
    });
    this.notifyCarersClosureChanged(householdId, 'added');
    return closure;
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

    const closure = await this.repo.update(closureId, input);
    this.notifyCarersClosureChanged(householdId, 'changed');
    return closure;
  }

  /** Hard-delete a closure. Owner/parent only. */
  async remove(
    userId: string,
    householdId: string,
    closureId: string
  ): Promise<void> {
    await this.assertWriteRole(userId, householdId);
    const closure = await this.queries.getOwned(userId, householdId, closureId);
    const household = await this.households.getOwned(userId, householdId);
    await this.repo.delete(closureId);
    this.notifyCarersClosureChanged(householdId, 'removed');

    const today = localDateOf(new Date(), household.timezone);
    const maxDate = addDays(today, 30);
    const dates = localDatesCovered(
      closure.starts_at,
      closure.ends_at,
      household.timezone
    ).filter(date => date >= today && date <= maxDate);

    for (const localDate of dates) {
      try {
        detectUncoveredCareBestEffort({
          householdId,
          localDate,
          cause: 'closureRemoved',
          actorId: userId,
          excludeUserId: userId,
        });
      } catch (error) {
        logger.error('Uncovered-care detection failed after closure removal', {
          householdId,
          localDate,
          error,
        });
      }
    }
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

  /** Carers need to know when family closures move their paid days. */
  private notifyCarersClosureChanged(
    householdId: string,
    change: ClosureChangeVerb
  ): void {
    void this.memberRepo
      .listActiveByHousehold(householdId)
      .then(members => {
        const carers = members.filter(m => CARER_ROLES.has(m.role));
        for (const carer of carers) {
          try {
            notifyUser(carer.user_id, {
              title: 'Household closure changed',
              body: CLOSURE_CHANGE_BODY[change],
              data: {
                type: PUSH_NOTIFICATION_TYPES.HOUSEHOLD_CLOSURE_CHANGED,
                householdId,
              },
            });
          } catch {
            // notifyUser is sync fire-and-forget; swallow any unexpected throw
          }
        }
      })
      .catch(error => {
        logger.error('Failed to notify carers of household closure change', {
          householdId,
          change,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

export const householdClosureCommandService =
  new HouseholdClosureCommandService();

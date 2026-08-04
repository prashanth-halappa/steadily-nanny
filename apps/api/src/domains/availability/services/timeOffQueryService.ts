/**
 * Time-off query service (CQRS-lite: reads only).
 *
 * @module domains/availability/services/timeOffQueryService
 */
import { HOUSEHOLD_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { HouseholdMemberRepository } from '../../household';
import { HouseholdNotFoundError } from '../../household/errors/householdErrors';
import { TimeOffNotFoundError } from '../errors/availabilityErrors';
import { CarerTimeOffRepository } from '../repositories/carerTimeOffRepository';
import type { CarerTimeOff } from '../types';

const CARER_ROLES = new Set<string>([
  HOUSEHOLD_ROLES.NANNY,
  HOUSEHOLD_ROLES.HELPER,
]);

export class TimeOffQueryService {
  constructor(
    private readonly timeOffRepo: CarerTimeOffRepository = new CarerTimeOffRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /** List the caller's own time-off rows. */
  async listOwn(userId: string): Promise<CarerTimeOff[]> {
    return this.timeOffRepo.listByUserId(userId);
  }

  /**
   * List time-off for carers (nanny/helper) who are active members of
   * `householdId`. Caller must be an active member of that household.
   * The carer id list is household-scoped; returned rows are each carer's
   * full personal time-off calendar (they are unavailable to every family),
   * not rows filtered to this household.
   */
  async listForHousehold(
    callerId: string,
    householdId: string
  ): Promise<CarerTimeOff[]> {
    await this.assertMember(callerId, householdId);
    const members = await this.memberRepo.listActiveByHousehold(householdId);
    const carerIds = members
      .filter(m => CARER_ROLES.has(m.role))
      .map(m => m.user_id);
    return this.timeOffRepo.listByUserIds(carerIds);
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

  private async assertMember(
    userId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      userId
    );
    if (!membership) {
      throw new HouseholdNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const timeOffQueryService = new TimeOffQueryService();

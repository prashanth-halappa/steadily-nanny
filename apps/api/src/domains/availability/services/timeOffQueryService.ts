/**
 * Time-off query service (CQRS-lite: reads only).
 *
 * @module domains/availability/services/timeOffQueryService
 */
import { HOUSEHOLD_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { AuthorizationError } from '../../../errors';
import { HouseholdMemberRepository } from '../../household';
import { HouseholdNotFoundError } from '../../household/errors/householdErrors';
import { TimeOffNotFoundError } from '../errors/availabilityErrors';
import { CarerTimeOffRepository } from '../repositories/carerTimeOffRepository';
import type { CarerTimeOff } from '../types';

/** Nanny only — matches timesheet/shift/schedule; helpers are read-only sitters. */
const CARER_ROLES = new Set<string>([HOUSEHOLD_ROLES.NANNY]);

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
   * List time-off for carers (nanny) who are active members of
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

  /**
   * THE write gate for `/v1/time-off`. Refuses a caller who no longer actively
   * belongs to ANY household.
   *
   * Why membership-anywhere rather than membership-in-a-household:
   * `carer_time_off` is PERSON-scoped — one row means "this carer is
   * unavailable to every family she works for" and there is no `household_id`
   * on it. So none of the three write paths has a household in scope to
   * authorize against, and before this they authorized against nothing at all:
   * POST was a bare insert, DELETE and PATCH checked `user_id` ownership only.
   * A nanny removed from every household she worked for still got a 201, and
   * her DELETE still drove `reconcileCancelledTimeOff` into a past household's
   * `pto_ledger` — a money write by a non-member. That was reachable the
   * moment past households became selectable in the picker.
   *
   * The API talks to Postgres with the service-role key and migration 049
   * dropped the client write policies, so this check is the ONLY gate. RLS
   * will not catch what it misses.
   *
   * ponytail: coarse by construction — a nanny active in household A may still
   * create time off while removed from B, and cancelling a row B had marked as
   * paid PTO still reverses B's ledger. Both are correct as they stand: the
   * time off genuinely applies to A (and B never sees it — `listForHousehold`
   * enumerates B's ACTIVE members only, so she is already invisible there),
   * and reversing money B recorded is the honest correction, not a new charge.
   * Give this a per-household signal only if `carer_time_off` ever gains a
   * household scope.
   */
  async assertActiveMember(userId: string): Promise<void> {
    const memberships = await this.memberRepo.listActiveByUser(userId);
    if (memberships.length === 0) {
      throw new AuthorizationError(
        'You are no longer a member of any household',
        'NOT_AN_ACTIVE_MEMBER',
        { userId }
      );
    }
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

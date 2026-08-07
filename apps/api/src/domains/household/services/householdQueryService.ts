/**
 * Household query service (CQRS-lite: reads only). Ownership here is
 * MEMBERSHIP, not an `owner_id` column — a household has an owner, possibly a
 * co-parent, one or more nannies, and maybe a view-only helper, and a nanny
 * belongs to several households. The repository is injectable so unit tests
 * can pass mocks.
 *
 * @module domains/household/services/householdQueryService
 */
import {
  HouseholdNotFoundError,
  InviteNotFoundError,
} from '../errors/householdErrors';
import { HouseholdInviteRepository } from '../repositories/householdInviteRepository';
import { HouseholdMemberRepository } from '../repositories/householdMemberRepository';
import { HouseholdRepository } from '../repositories/householdRepository';
import type { Household, HouseholdMember, InvitePreview } from '../types';

export class HouseholdQueryService {
  constructor(
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly inviteRepo: HouseholdInviteRepository = new HouseholdInviteRepository()
  ) {}

  /** List the households the caller actively belongs to. */
  async listForUser(userId: string): Promise<Household[]> {
    const ids = await this.memberRepo.listActiveHouseholdIds(userId);
    if (ids.length === 0) {
      return [];
    }
    return this.householdRepo.findByIds(ids);
  }

  /**
   * List the households the caller was REMOVED from. Deliberately separate
   * from `listForUser` rather than merged into it: everything downstream of
   * "which household am I in" — writes, role gating, the picker's default —
   * keys off the active list, and folding removed rows into it would hand a
   * removed member a household she can appear to act in. She gets read-only
   * access to her own money history there, nothing more.
   */
  async listPastForUser(userId: string): Promise<Household[]> {
    const ids = await this.memberRepo.listRemovedHouseholdIds(userId);
    if (ids.length === 0) {
      return [];
    }
    return this.householdRepo.findByIds(ids);
  }

  /**
   * Fetch one household, enforcing membership. Throws HouseholdNotFoundError
   * for both "doesn't exist" and "exists but you are not a member" — the SAME
   * error for both, so a non-member can never learn a household exists. This
   * is the `lookup` the ownership middleware calls on /:householdId routes.
   */
  async getOwned(userId: string, householdId: string): Promise<Household> {
    await this.getMembership(userId, householdId);
    const household = await this.householdRepo.findById(householdId);
    if (!household) {
      throw new HouseholdNotFoundError(householdId);
    }
    return household;
  }

  /**
   * Fetch the caller's own membership row for a household — used by the
   * command service for role checks (owner/parent write, nanny/helper don't).
   * Same not-found-vs-not-a-member indistinguishability as getOwned.
   */
  async getMembership(
    userId: string,
    householdId: string
  ): Promise<HouseholdMember> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      userId
    );
    if (!membership) {
      throw new HouseholdNotFoundError(householdId);
    }
    return membership;
  }

  /**
   * List every membership the caller has, across all households — how mobile
   * learns "what is my role in each household" without walking `listMembers`
   * per household and filtering by userId.
   *
   * INCLUDES `removed` rows, deliberately, and this is the only read that
   * does. The client needs them for two decisions it cannot make otherwise: a
   * removed member is ONBOARDED (she has an account and money owed — reporting
   * her as a new user routes her into the signup wizard and strands it), and
   * she is READ-ONLY in that household (`useIsOnboarded().isPastMember`, the
   * gate every write affordance ANDs into its role check). Filtered to active,
   * that gate could never be true and the whole read-only path was dead code.
   *
   * This grants nothing. Every server-side write gate resolves membership
   * through `findActiveMembership` / `listActiveByUser`, never through here.
   */
  async listMembershipsForUser(userId: string): Promise<HouseholdMember[]> {
    return this.memberRepo.listByUser(userId);
  }

  /** List a household's active members. Caller must already be a member. */
  async listMembers(
    userId: string,
    householdId: string
  ): Promise<HouseholdMember[]> {
    await this.getMembership(userId, householdId);
    return this.memberRepo.listActiveByHousehold(householdId);
  }

  /**
   * Preview an invite by its code — deliberately NOT membership-gated (the
   * redeemer isn't a member yet). Returns only the household name, active
   * children's first names, and the proposed role; nothing else.
   */
  async previewInvite(code: string): Promise<InvitePreview> {
    const invite = await this.inviteRepo.findByCode(code);
    if (!invite) {
      throw new InviteNotFoundError(code);
    }
    const household = await this.householdRepo.findById(invite.household_id);
    if (!household) {
      throw new InviteNotFoundError(code);
    }
    const childrenFirstNames =
      await this.householdRepo.listActiveChildFirstNames(invite.household_id);
    return {
      household_name: household.name,
      children_first_names: childrenFirstNames,
      role: invite.role,
    };
  }
}

// Singleton for controllers/routes that don't need DI.
export const householdQueryService = new HouseholdQueryService();

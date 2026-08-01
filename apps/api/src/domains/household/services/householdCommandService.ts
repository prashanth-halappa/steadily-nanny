/**
 * Household command service (CQRS-lite: writes). Role checks live here, one
 * line at the top of each method — this is the slot the deleted widget
 * example's entitlement gate used to occupy. household_members is checked,
 * not an `owner_id` column: a household has an owner, a co-parent, one or
 * more nannies, and maybe a helper, and a nanny belongs to several households.
 *
 * @module domains/household/services/householdCommandService
 */
import {
  AlreadyMemberError,
  InviteAlreadyAcceptedError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteRevokedError,
  NotAHouseholdParentError,
} from '../errors/householdErrors';
import { HouseholdInviteRepository } from '../repositories/householdInviteRepository';
import { HouseholdMemberRepository } from '../repositories/householdMemberRepository';
import { HouseholdRepository } from '../repositories/householdRepository';
import {
  HOUSEHOLD_INVITE_STATUSES,
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
} from '../schemas';
import type {
  CreateHouseholdInput,
  CreateHouseholdInviteInput,
  Household,
  HouseholdInvite,
  HouseholdMember,
  RedeemHouseholdInviteInput,
  UpdateHouseholdInput,
} from '../types';
import { generateUniqueInviteCode } from '../utils/inviteCode';
import {
  type HouseholdQueryService,
  householdQueryService,
} from './householdQueryService';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

export class HouseholdCommandService {
  constructor(
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly inviteRepo: HouseholdInviteRepository = new HouseholdInviteRepository(),
    private readonly queries: HouseholdQueryService = householdQueryService
  ) {}

  /**
   * Create a household AND the creator's owner membership together. A
   * household with no members is unreachable by anyone (deleting a user
   * cascades away memberships but leaves the household orphaned, since
   * `created_by` is `ON DELETE SET NULL`) — so if the membership insert
   * fails, the just-created household is deleted rather than left
   * half-created.
   */
  async create(
    userId: string,
    input: CreateHouseholdInput
  ): Promise<Household> {
    const household = await this.householdRepo.create({
      ...input,
      created_by: userId,
    });

    try {
      await this.memberRepo.createMembership({
        household_id: household.id,
        user_id: userId,
        role: HOUSEHOLD_ROLES.OWNER,
        can_edit: true,
        status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
      });
    } catch (error) {
      await this.rollbackOrphanedHousehold(household.id);
      throw error;
    }

    return household;
  }

  /** Update mutable household fields. Owner/parent only. */
  async update(
    userId: string,
    householdId: string,
    input: UpdateHouseholdInput
  ): Promise<Household> {
    const membership = await this.queries.getMembership(userId, householdId);
    this.assertWriteRole(householdId, membership);
    return this.householdRepo.update(householdId, input);
  }

  /** Generate an invite code for a household. Owner/parent only. */
  async createInvite(
    userId: string,
    householdId: string,
    input: CreateHouseholdInviteInput
  ): Promise<HouseholdInvite> {
    const membership = await this.queries.getMembership(userId, householdId);
    this.assertWriteRole(householdId, membership);

    const code = await generateUniqueInviteCode(async candidate => {
      const existing = await this.inviteRepo.findByCode(candidate);
      return existing !== null;
    });

    return this.inviteRepo.create({
      household_id: householdId,
      code,
      email: input.email ?? null,
      role: input.role,
      invited_by: userId,
    });
  }

  /**
   * Redeem an invite for the caller. Idempotent-safe: a pending invite
   * already consumed by the time this runs fails cleanly at the status check
   * below (never a 500), and a genuinely concurrent double-redeem is caught
   * by the repository's unique-constraint translation (see
   * `householdMemberRepository.createMembership`) rather than surfacing as
   * one.
   */
  async redeemInvite(
    userId: string,
    input: RedeemHouseholdInviteInput
  ): Promise<HouseholdMember> {
    const code = input.code.trim().toUpperCase();
    const invite = await this.inviteRepo.findByCode(code);
    if (!invite) {
      throw new InviteNotFoundError(code);
    }
    if (invite.status === HOUSEHOLD_INVITE_STATUSES.REVOKED) {
      throw new InviteRevokedError(code);
    }
    if (invite.status === HOUSEHOLD_INVITE_STATUSES.ACCEPTED) {
      throw new InviteAlreadyAcceptedError(code);
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      throw new InviteExpiredError(code);
    }

    const existingMembership = await this.memberRepo.findActiveMembership(
      invite.household_id,
      userId
    );
    if (existingMembership) {
      throw new AlreadyMemberError(invite.household_id);
    }

    const membership = await this.memberRepo.createMembership({
      household_id: invite.household_id,
      user_id: userId,
      role: invite.role,
      can_edit: false,
      status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
    });

    await this.inviteRepo.update(invite.id, {
      status: HOUSEHOLD_INVITE_STATUSES.ACCEPTED,
      accepted_by: userId,
      accepted_at: new Date().toISOString(),
    });

    return membership;
  }

  private assertWriteRole(
    householdId: string,
    membership: HouseholdMember
  ): void {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(householdId, membership.role);
    }
  }

  /** Best-effort cleanup; a rollback failure must never mask the original error. */
  private async rollbackOrphanedHousehold(householdId: string): Promise<void> {
    try {
      await this.householdRepo.delete(householdId);
    } catch {
      // The original member-insert error is already being thrown by the
      // caller; a failed cleanup here must not replace it.
    }
  }
}

// Singleton for controllers that don't need DI.
export const householdCommandService = new HouseholdCommandService();

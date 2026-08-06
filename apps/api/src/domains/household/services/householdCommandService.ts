/**
 * Household command service (CQRS-lite: writes). Role checks live here, one
 * line at the top of each method — this is the slot the deleted widget
 * example's entitlement gate used to occupy. household_members is checked,
 * not an `owner_id` column: a household has an owner, a co-parent, one or
 * more nannies, and maybe a helper, and a nanny belongs to several households.
 *
 * @module domains/household/services/householdCommandService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { notifyHouseholdParents } from '../../notification';
import { UserService } from '../../user/services/userService';
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

/**
 * Crash-recovery window: how long an `accepted` invite with no membership row
 * must sit before a later redeemer is allowed to release the claim. A genuine
 * in-flight accept finishes in seconds — anything this stale is a process that
 * died between the claim and the membership insert.
 *
 * ponytail: heals on read only, so a stranded code is unusable until someone
 * retries it after this window — and one nobody ever retries stays burned.
 * That harms nobody; add a sweep only if support tickets say otherwise.
 */
const STRANDED_CLAIM_MS = 15 * 60 * 1000;

export class HouseholdCommandService {
  constructor(
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly inviteRepo: HouseholdInviteRepository = new HouseholdInviteRepository(),
    private readonly queries: HouseholdQueryService = householdQueryService,
    private readonly users: Pick<
      typeof UserService,
      'ensureProfile'
    > = UserService
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
    // `created_by` and the owner membership both FK to user_profiles, and
    // nothing else creates that row on this path.
    await this.users.ensureProfile(userId);

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
   * Redeem an invite for the caller. A code is SINGLE-USE, and the only thing
   * that can enforce that is the conditional write: the status checks below
   * are read-then-act, so two people redeeming the same code concurrently both
   * pass them. `inviteRepo.claimPending` compare-and-sets on
   * `status = 'pending'` and runs BEFORE the membership insert, so exactly one
   * racer proceeds and the losers get a clean `InviteAlreadyAcceptedError`.
   *
   * The unique constraint on `(household_id, user_id)` — translated to
   * `AlreadyMemberError` by `householdMemberRepository.createMembership` —
   * only ever catches the SAME user redeeming twice, never two different
   * people racing for one code.
   */
  async redeemInvite(
    userId: string,
    input: RedeemHouseholdInviteInput
  ): Promise<HouseholdMember> {
    // Same FK as `create`, and this path has no client-side bootstrap at all:
    // a nanny's first ever API call can be this one.
    await this.users.ensureProfile(userId);

    const code = input.code.trim().toUpperCase();
    const invite = await this.inviteRepo.findByCode(code);
    if (!invite) {
      throw new InviteNotFoundError(code);
    }
    if (invite.status === HOUSEHOLD_INVITE_STATUSES.REVOKED) {
      throw new InviteRevokedError(code);
    }
    // Expiry before the heal: releasing wipes `accepted_by`/`accepted_at`, and
    // an expired code is unredeemable anyway — no reason to lose the record of
    // who consumed it.
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      throw new InviteExpiredError(code);
    }
    if (invite.status === HOUSEHOLD_INVITE_STATUSES.ACCEPTED) {
      // Either genuinely used, or stranded by a crash — the latter is healable
      // and falls through to a fresh claim below.
      await this.releaseStrandedClaim(invite, code);
    }

    const existingMembership = await this.memberRepo.findActiveMembership(
      invite.household_id,
      userId
    );
    if (existingMembership) {
      throw new AlreadyMemberError(invite.household_id);
    }

    const claimed = await this.inviteRepo.claimPending(invite.id, userId);
    if (!claimed) {
      throw new InviteAlreadyAcceptedError(code);
    }

    let membership: HouseholdMember;
    try {
      membership = await this.memberRepo.createMembership({
        household_id: invite.household_id,
        user_id: userId,
        role: invite.role,
        can_edit: false,
        status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
      });
    } catch (error) {
      await this.releaseInviteClaim(claimed.id, userId, claimed.accepted_at);
      throw error;
    }

    const roleLabel =
      invite.role === HOUSEHOLD_ROLES.NANNY
        ? 'nanny'
        : invite.role === HOUSEHOLD_ROLES.PARENT
          ? 'parent'
          : invite.role === HOUSEHOLD_ROLES.HELPER
            ? 'helper'
            : invite.role;
    try {
      notifyHouseholdParents(invite.household_id, {
        title: 'Someone joined your household',
        body: `Your invite was redeemed — a new ${roleLabel} joined the household.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          householdId: invite.household_id,
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw
    }

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

  /**
   * Best-effort un-claim after a failed membership insert. Without it the
   * invite is left `accepted` with nobody in the household, and the same user
   * retrying hits `InviteAlreadyAcceptedError` — a transient database error
   * would cost them the code permanently. Reachable on the removed-member path
   * too: `findActiveMembership` can't see a `removed` row, so that user sails
   * past the pre-check and trips the unique constraint here instead.
   *
   * A process that dies before this catch runs is covered by the on-read
   * self-heal in `releaseStrandedClaim` instead.
   *
   * `acceptedAt` comes from the row `claimPending` just returned — the claim
   * this request actually won — so a release can never free a later one.
   */
  private async releaseInviteClaim(
    inviteId: string,
    userId: string,
    acceptedAt: string | null
  ): Promise<void> {
    if (!acceptedAt) {
      return;
    }
    try {
      await this.inviteRepo.releaseClaim(inviteId, userId, acceptedAt);
    } catch {
      // The membership error is already on its way to the caller; a failed
      // release must not replace it.
    }
  }

  /**
   * On-read self-heal for an invite left `accepted` by a process that died
   * between the claim and the membership insert: the code is burned but nobody
   * ever joined, and the compensation in `redeemInvite`'s catch never ran.
   * Releases the claim so the caller can re-claim it; throws the ordinary
   * already-used error in every other case.
   *
   * Released only when the claim names a claimer, is older than the
   * crash-recovery window, and that claimer has NO membership row of ANY status
   * — any-status deliberately, so a removed ex-member's consumed code is never
   * resurrected. The `claimedBy` null check is load-bearing on its own: `009`
   * declares `accepted_by ... on delete set null` and membership rows cascade
   * away with the account, so a DELETED claimer leaves an accepted invite with
   * no claimer and no membership — indistinguishable from a crash by every
   * other check here. Refuse it.
   *
   * The release is CAS'd on the `accepted_at` we read, so a claim re-taken
   * between that read and this write is never freed, and a failed release
   * surfaces rather than letting the caller claim over someone else's invite.
   */
  private async releaseStrandedClaim(
    invite: HouseholdInvite,
    code: string
  ): Promise<void> {
    const claimedBy = invite.accepted_by;
    const claimedAt = invite.accepted_at;
    if (
      !claimedBy ||
      !claimedAt ||
      Date.now() - new Date(claimedAt).getTime() < STRANDED_CLAIM_MS
    ) {
      throw new InviteAlreadyAcceptedError(code);
    }

    const claimerMembership = await this.memberRepo.findMembershipAnyStatus(
      invite.household_id,
      claimedBy
    );
    if (claimerMembership) {
      throw new InviteAlreadyAcceptedError(code);
    }

    await this.inviteRepo.releaseClaim(invite.id, claimedBy, claimedAt);
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

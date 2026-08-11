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
// Repository modules directly, NOT the domain barrels: a barrel pulls in that
// domain's services, and one of those reaching back for household membership
// would close an import cycle.
import { PayArrangementRepository } from '../../pay/repositories/payArrangementRepository';
import { PtoLedgerRepository } from '../../pay/repositories/ptoLedgerRepository';
// Imported from the repository module directly, NOT the timesheet domain
// barrel: the barrel pulls in the timesheet services, and one of those reaching
// back for household membership would close an import cycle.
import { TimeEntryRepository } from '../../timesheet/repositories/timeEntryRepository';
import { TimesheetRepository } from '../../timesheet/repositories/timesheetRepository';
import { localDateOf } from '../../timesheet/utils/weekStart';
import { UserService } from '../../user/services/userService';
import {
  AlreadyMemberError,
  CannotLeaveAsOwnerError,
  CannotLeaveWhileClockedInError,
  CannotRemoveOwnerError,
  CannotRemoveSelfError,
  InviteAlreadyAcceptedError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteNotPendingError,
  InviteRevokedError,
  MemberHasRunningEntryError,
  MemberNotFoundError,
  NotAHouseholdParentError,
  WeekStartLockedError,
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
    > = UserService,
    private readonly timeEntries: Pick<
      TimeEntryRepository,
      'findRunningInHousehold'
    > = new TimeEntryRepository(),
    private readonly payArrangements: Pick<
      PayArrangementRepository,
      'endForCarer'
    > = new PayArrangementRepository(),
    private readonly ptoLedger: Pick<
      PtoLedgerRepository,
      'listForCarerYear'
    > = new PtoLedgerRepository(),
    private readonly timesheets: Pick<
      TimesheetRepository,
      'existsForHousehold'
    > = new TimesheetRepository()
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

  /**
   * Update mutable household fields. Owner/parent only.
   *
   * `week_starts_on` gets one extra guard: it defines pay-week boundaries
   * (FLSA fixed workweek, 075_household_week_starts_on.sql), so once any
   * timesheet has been recorded it can no longer move — moving it would
   * reprice weeks nobody re-approved. The existence check runs ONLY when the
   * field is present AND differs from the current value, so an unrelated
   * update (or resubmitting the same value) never pays for the extra query.
   */
  async update(
    userId: string,
    householdId: string,
    input: UpdateHouseholdInput
  ): Promise<Household> {
    const membership = await this.queries.getMembership(userId, householdId);
    this.assertWriteRole(householdId, membership);

    if (input.week_starts_on !== undefined) {
      const current = await this.householdRepo.findById(householdId);
      if (current && input.week_starts_on !== current.week_starts_on) {
        const hasTimesheets =
          await this.timesheets.existsForHousehold(householdId);
        if (hasTimesheets) {
          throw new WeekStartLockedError(householdId);
        }
      }
    }

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

    // ANY status, not just active: a removed ex-member still owns a membership
    // row, so the unique `(household_id, user_id)` constraint makes a fresh
    // insert impossible for them. Active is the only state that refuses here,
    // and it refuses BEFORE the claim so a no-op never burns a single-use code.
    const existingMembership = await this.memberRepo.findMembershipAnyStatus(
      invite.household_id,
      userId
    );
    if (existingMembership?.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE) {
      throw new AlreadyMemberError(invite.household_id);
    }

    const claimed = await this.inviteRepo.claimPending(invite.id, userId);
    if (!claimed) {
      throw new InviteAlreadyAcceptedError(code);
    }

    let membership: HouseholdMember;
    if (existingMembership) {
      const reactivated = await this.memberRepo.reactivateMembership(
        existingMembership.id,
        invite.role
      );
      if (!reactivated) {
        // Another redeem reactivated the row between the read and this write,
        // so the claim bought nothing — hand the code back, CAS'd on the
        // accepted_at THIS request won so a later claim is never freed.
        await this.releaseInviteClaim(claimed.id, userId, claimed.accepted_at);
        throw new AlreadyMemberError(invite.household_id);
      }
      membership = reactivated;
    } else {
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
    }

    const roleLabel = this.roleLabel(invite.role);
    // Same push type either way — "someone has access again" is the same alert
    // to a parent who did not send the invite; only the wording differs.
    const rejoined = existingMembership !== null;
    const carriedPto = rejoined
      ? await this.carriedOverPtoSentence(invite.household_id, userId)
      : '';
    try {
      notifyHouseholdParents(invite.household_id, {
        title: rejoined
          ? 'Someone rejoined your household'
          : 'Someone joined your household',
        body: rejoined
          ? `Your invite was redeemed — a ${roleLabel} rejoined the household.${carriedPto}`
          : `Your invite was redeemed — a new ${roleLabel} joined the household.`,
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

  /**
   * Soft-remove a member. Owner/parent only.
   *
   * Removal also END-DATES the carer's pay arrangement (065), so a rejoin has
   * no live terms and a parent must re-confirm them — owner decision, see
   * docs/11-MONEY.md §10. Historical weeks keep pricing: the end is a
   * per-date exclusion, not a hidden row.
   *
   * `now` is injectable purely for deterministic tests of the household-local
   * date boundary; production callers never pass it (same convention as
   * `ptoQueryService.balance`).
   *
   * ponytail: three things this deliberately does NOT do. Pending change
   * requests and approvals raised by or for the member are left alone — they
   * age out through the F-B5-5 sweep. Pending invites the member created stay
   * redeemable; a parent can revoke them individually (`revokeInvite`). And
   * there is no `removed_at` column: `updated_at` already dates the transition
   * closely enough for support, and adding one costs a migration.
   */
  async removeMember(
    callerId: string,
    householdId: string,
    memberId: string,
    now: () => Date = () => new Date()
  ): Promise<HouseholdMember> {
    const membership = await this.queries.getMembership(callerId, householdId);
    this.assertWriteRole(householdId, membership);

    const target = await this.memberRepo.findById(memberId);
    // A member id from another household reads as missing, so a parent can
    // never probe ids outside their own.
    if (!target || target.household_id !== householdId) {
      throw new MemberNotFoundError(memberId);
    }
    // The owner is un-removable, which is also the last-parent rule: the owner
    // membership is created with the household and can never be revoked, so a
    // household cannot be left with nobody who can write to it.
    if (target.role === HOUSEHOLD_ROLES.OWNER) {
      throw new CannotRemoveOwnerError(householdId);
    }
    // "Leave household" is a separate feature with different consequences
    // (a parent leaving vs being removed), not a self-directed PATCH here.
    if (target.user_id === callerId) {
      throw new CannotRemoveSelfError(householdId);
    }
    // Scoped to THIS household, not the carer's global running entry: a nanny
    // clocked in at another family is removable here, and their shift
    // elsewhere is never disclosed to this one. Removing them mid-shift in
    // THIS household strands an entry nobody can clock out — they lose the
    // household and the hours never reach a timesheet.
    const running = await this.timeEntries.findRunningInHousehold(
      householdId,
      target.user_id
    );
    if (running) {
      throw new MemberHasRunningEntryError(memberId);
    }

    // End the pay arrangement BEFORE the membership flip. Either order can
    // fail halfway; only this one cannot strand. Membership-first leaves a
    // removed member with live terms — the exact bug — if this write throws.
    // This way a throw refuses the whole removal with nothing changed, and if
    // the CAS below then finds nothing it is because someone else already
    // removed them, in which case end-dating was correct anyway.
    //
    // The date is household-LOCAL: server-UTC "today" is a day out east of
    // UTC and would cut the terms short before a shift already worked
    // (041's header records the same trap for `valid_from`).
    const householdRow = await this.householdRepo.findById(householdId);
    if (!householdRow) {
      throw new MemberNotFoundError(memberId);
    }
    await this.payArrangements.endForCarer(
      householdId,
      target.user_id,
      localDateOf(now(), householdRow.timezone)
    );

    const removed = await this.memberRepo.removeMembership(memberId);
    if (!removed) {
      // CAS matched nothing: already removed, or another parent won the race.
      throw new MemberNotFoundError(memberId);
    }
    return removed;
  }

  /**
   * Leave a household, self-service. This is the "separate feature" the
   * `CannotRemoveSelfError` guard in `removeMember` points at: the same end
   * state on the row, reached through a different door.
   *
   * What differs from a removal, and why:
   * - Authorization is your own membership and nothing else. Any active role
   *   may leave, so there is no `assertWriteRole` here — a nanny walking out is
   *   the main case, and needing a parent's permission to stop working for a
   *   family is not a product we would ship.
   * - The OWNER is refused (`CannotLeaveAsOwnerError`), for exactly the reason
   *   `CannotRemoveOwnerError` refuses removing them: the owner membership is
   *   created with the household and never revoked, so no path may leave a
   *   household with nobody who can write to it.
   * - Pay is end-dated only for a NANNY. A removal calls `endForCarer`
   *   unconditionally because the target is whoever a parent picked; here the
   *   role is already in hand, and a co-parent or helper has no arrangement to
   *   end — calling it for them is a write nobody asked for.
   *
   * What is deliberately IDENTICAL to removal: the running-entry refusal
   * (leaving mid-shift strands an entry nobody can close), the end-date-then-
   * flip ordering (the only order that cannot leave a departed member with live
   * terms), and the household-LOCAL date the terms end on.
   *
   * `now` is injectable only for deterministic tests of that date boundary;
   * production callers never pass it.
   */
  async leave(
    callerId: string,
    householdId: string,
    now: () => Date = () => new Date()
  ): Promise<HouseholdMember> {
    // Throws HouseholdNotFoundError for both "no such household" and "not a
    // member" — a stranger learns nothing either way.
    const membership = await this.queries.getMembership(callerId, householdId);

    if (membership.role === HOUSEHOLD_ROLES.OWNER) {
      throw new CannotLeaveAsOwnerError(householdId);
    }

    // Scoped to THIS household, same as removal: a nanny clocked in at another
    // family may still leave this one, and that shift is never disclosed here.
    const running = await this.timeEntries.findRunningInHousehold(
      householdId,
      callerId
    );
    if (running) {
      throw new CannotLeaveWhileClockedInError(householdId);
    }

    if (membership.role === HOUSEHOLD_ROLES.NANNY) {
      const householdRow = await this.householdRepo.findById(householdId);
      if (!householdRow) {
        throw new MemberNotFoundError(membership.id);
      }
      await this.payArrangements.endForCarer(
        householdId,
        callerId,
        localDateOf(now(), householdRow.timezone)
      );
    }

    const removed = await this.memberRepo.removeMembership(membership.id);
    if (!removed) {
      // CAS matched nothing: a parent removed them between the read and here,
      // or a duplicate tap won first.
      throw new MemberNotFoundError(membership.id);
    }

    const roleLabel = this.roleLabel(membership.role);
    // Nobody in the household initiated this, so without a push the family
    // finds out when a shift goes uncovered.
    //
    // ponytail: the type is INVITE_REDEEMED, which is a lie in the name and
    // true in every effect a client observes — it is the household's
    // membership-changed push, and `notificationRouteMap` sends it to
    // `/(private)/settings/household`, exactly where a parent reading "someone
    // left" needs to land. There is no MEMBER_LEFT literal to use: the union
    // lives in `packages/shared-types/schemas/notification.schema`, and adding
    // one obliges the mobile route map to grow a matching entry in the same
    // change (the exhaustiveness test enforces it). Split it out when that
    // package is next touched; the wording, not the type, is what a recipient
    // actually reads.
    try {
      notifyHouseholdParents(householdId, {
        title: 'Someone left your household',
        body: `A ${roleLabel} left the household.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          householdId,
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected
      // throw — the membership row is already flipped and must not be undone by
      // a notification failure.
    }

    return removed;
  }

  /** Revoke a pending invite so its code stops working. Owner/parent only. */
  async revokeInvite(
    callerId: string,
    householdId: string,
    inviteId: string
  ): Promise<HouseholdInvite> {
    const membership = await this.queries.getMembership(callerId, householdId);
    this.assertWriteRole(householdId, membership);

    const revoked = await this.inviteRepo.revokePending(inviteId, householdId);
    if (revoked) {
      return revoked;
    }

    // The CAS carries the household, so a null means one of: no such invite,
    // someone else's invite, or ours but no longer pending. Only the last is
    // safe to describe.
    const existing = await this.inviteRepo.findById(inviteId);
    if (!existing || existing.household_id !== householdId) {
      throw new InviteNotFoundError(inviteId);
    }
    throw new InviteNotPendingError(inviteId, existing.status);
  }

  /**
   * The rejoining carer's leftover PTO, as a sentence to append to the rejoin
   * push — or '' when there is nothing to say.
   *
   * The balance is deliberately KEPT across a removal (owner decision: do not
   * reset, do not forfeit), which makes the rejoin the moment a parent needs
   * to see it: they are the only ones who can adjust it, and a PTO correction
   * already exists. A zero is omitted rather than reported — "0 hours carried
   * over" is noise.
   *
   * Same year-window as `ptoQueryService.balance` (the ledger read is scoped
   * to one calendar year), so a rejoin in a NEW year legitimately says
   * nothing: last year's leftover is not part of this year's balance for
   * anyone, rejoiner or not.
   *
   * Never throws: a detail on a push must not cost the carer their access.
   */
  private async carriedOverPtoSentence(
    householdId: string,
    carerId: string
  ): Promise<string> {
    try {
      const household = await this.householdRepo.findById(householdId);
      if (!household) {
        return '';
      }
      const year = Number(
        localDateOf(new Date(), household.timezone).slice(0, 4)
      );
      const rows = await this.ptoLedger.listForCarerYear(
        householdId,
        carerId,
        year
      );
      const minutes = rows.reduce((total, row) => total + row.minutes, 0);
      if (minutes <= 0) {
        return '';
      }
      const hours = Number((minutes / 60).toFixed(1));
      return ` They have ${hours} hours of PTO carried over — adjust it if that is not right.`;
    } catch {
      return '';
    }
  }

  /**
   * The role as it reads inside a push body. Falls back to the raw value rather
   * than throwing: a role added to the enum without touching this map should
   * cost a slightly stiff notification, never the write that triggered it.
   */
  private roleLabel(role: string): string {
    if (role === HOUSEHOLD_ROLES.NANNY) {
      return 'nanny';
    }
    if (role === HOUSEHOLD_ROLES.PARENT) {
      return 'parent';
    }
    if (role === HOUSEHOLD_ROLES.HELPER) {
      return 'helper';
    }
    return role;
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
   * would cost them the code permanently. Also the compensation for a lost
   * reactivation CAS, where the claim likewise bought nothing. The unique
   * constraint still fires here when the SAME user's concurrent redeem inserts
   * first — the removed-member case no longer reaches it, since the pre-check
   * now reads any status and routes those to reactivation.
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
   * between that read and this write is never freed. That CAS missing is
   * SILENT — `releaseClaim` returns void, so a zero-row update is
   * indistinguishable from a successful one here; what actually stops the
   * caller claiming over someone else's invite is the `claimPending` CAS on
   * the next line, which finds the invite still `accepted` and returns null.
   * Only a genuine database error surfaces from the release itself.
   *
   * ponytail: unchanged by the rejoin path on purpose. A crash between the
   * claim and the REACTIVATION burns the code exactly as it burns one between
   * the claim and an insert — the claimer now has a `removed` row, the
   * any-status lookup finds it, and the heal refuses. That is the correct
   * refusal: healing on a removed claimer's row is precisely the resurrection
   * hole this guard exists to close. The parent reissues an invite; upgrade
   * only if that turns into real support volume.
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

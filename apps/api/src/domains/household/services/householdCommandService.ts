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
// Straight from the shared package, not via the terms-proposal domain: that
// package is a leaf and imports nothing of ours, so there is no cycle to dodge.
import { TERMS_PROPOSAL_DIRECTIONS } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { ConflictError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { notifyHouseholdParents, notifyUser } from '../../notification';
// Repository modules directly, NOT the domain barrels: a barrel pulls in that
// domain's services, and one of those reaching back for household membership
// would close an import cycle.
import { PayArrangementRepository } from '../../pay/repositories/payArrangementRepository';
import { PtoLedgerRepository } from '../../pay/repositories/ptoLedgerRepository';
// Imported from the repository module directly, NOT the timesheet domain
// barrel: the barrel pulls in the timesheet services, and one of those reaching
// back for household membership would close an import cycle.
// The ERRORS module directly, not the terms-proposal barrel: the barrel pulls
// `termsProposalCommandService`, which imports `../../household`. This module
// imports nothing but `../../../errors`, so the edge is a leaf.
import {
  OpenTermsProposalExistsError,
  TermsProposalValidationError,
} from '../../termsProposal/errors/termsProposalErrors';
import { TermsProposalRepository } from '../../termsProposal/repositories/termsProposalRepository';
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
  PayOfferNotForRoleError,
  WeekStartLockedError,
} from '../errors/householdErrors';
import { HouseholdHolidayRepository } from '../repositories/householdHolidayRepository';
import { HouseholdInviteRepository } from '../repositories/householdInviteRepository';
import { HouseholdMemberRepository } from '../repositories/householdMemberRepository';
import { HouseholdRepository } from '../repositories/householdRepository';
import {
  DEFAULT_INVITE_LINK_WINDOW_DAYS,
  HOUSEHOLD_INVITE_STATUSES,
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
  HOUSEHOLD_STATES,
} from '../schemas';
import type {
  CreateHouseholdInput,
  CreateHouseholdInviteInput,
  Household,
  HouseholdHoliday,
  HouseholdInvite,
  HouseholdMember,
  RedeemHouseholdInviteBody,
  SetHouseholdHolidaysRequest,
  UpdateHouseholdInput,
} from '../types';
import { isDraftAuthor } from '../utils/assertHouseholdRole';
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

/**
 * The same literal `payArrangementCommandService`, `termsProposalCommandService`
 * and 033's backfill all use, so an unnamed carer reads identically across the
 * whole payroll record. Private in each of them, hence the repetition.
 */
const UNNAMED_CARER_DISPLAY_NAME = 'Carer';

/**
 * D-16's future horizon for a pay start date, in months. The THIRD copy of
 * this constant: `payArrangementCommandService` owns the original and
 * `termsProposalCommandService` already mirrors it, both keeping the constant
 * and their `addMonthsISO` helper module-private, so neither can be imported.
 * Importing the terms-proposal SERVICE would be worse than a mirror anyway —
 * it imports `../../household`, so the edge would close a cycle.
 *
 * The three must not drift. An offer that passes here and is refused at
 * promotion is terms a parent typed and a nanny never sees; one that passes
 * here and is refused at ACCEPTANCE is worse still, because both sides have
 * already agreed by then.
 *
 * ponytail: a third private copy, not an extraction. Lift all three into a
 * shared `pay` util the next time `payArrangementCommandService` is open —
 * doing it from here means editing a file another session owns.
 */
const MAX_FUTURE_MONTHS = 12;

/**
 * The horizon date, `months` after `dateISO`. Same UTC-Date-rollover technique
 * as the two copies named above, character for character, so the three "how
 * far is 12 months" answers cannot disagree.
 */
function addMonthsISO(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1 + months, d ?? 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Is this offer's start date still reachable? Measured in HOUSEHOLD-local
 * time, never server-UTC: east of UTC the server is already on tomorrow, and
 * 041's header records the same trap for `valid_from`.
 *
 * A PAST date is fine and stays fine — 076's effective-arrangement rule reads
 * the greatest `valid_from <= date`, so back-dating terms to the day she
 * actually started is the ordinary case. Only the future is bounded.
 */
function isWithinFutureHorizon(
  validFrom: string,
  timezone: string,
  now: Date
): boolean {
  // ISO dates compare correctly as strings — both sides are YYYY-MM-DD.
  return (
    validFrom <= addMonthsISO(localDateOf(now, timezone), MAX_FUTURE_MONTHS)
  );
}

export class HouseholdCommandService {
  constructor(
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly inviteRepo: HouseholdInviteRepository = new HouseholdInviteRepository(),
    private readonly queries: HouseholdQueryService = householdQueryService,
    // `getProfileById` joined `ensureProfile` here for P8: the promoted
    // proposal snapshots the carer's display name at insert (033 discipline,
    // and 092 makes the column `not null`).
    private readonly users: Pick<
      typeof UserService,
      'ensureProfile' | 'getProfileById'
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
    > = new TimesheetRepository(),
    private readonly holidays: Pick<
      HouseholdHolidayRepository,
      'upsertMany' | 'listForHousehold' | 'seedFederalSet'
    > = new HouseholdHolidayRepository(),
    // P8's promotion target. The REPOSITORY, never the terms-proposal domain
    // barrel — see the import note at the top of this file.
    private readonly proposals: Pick<
      TermsProposalRepository,
      'create'
    > = new TermsProposalRepository()
  ) {}

  /**
   * Create a household AND the creator's membership together. A household with
   * no members is unreachable by anyone (deleting a user cascades away
   * memberships but leaves the household orphaned, since `created_by` is
   * `ON DELETE SET NULL`) — so if the membership insert fails, the
   * just-created household is deleted rather than left half-created.
   *
   * A DRAFT (`state: 'draft'`, D-34) is the same two writes with a different
   * membership: the creator is a NANNY, not an owner, and that single
   * difference is the whole of D-36. `WRITE_ROLES = {owner, parent}` gates the
   * `pay_arrangements` insert, so a household whose only member is a nanny
   * contains nobody who can price anything — "nothing priceable" is enforced
   * by the membership table rather than by hiding buttons, and it stays true
   * however the UI changes. What she CAN write in it is the §2.2 capability,
   * four named doors wide.
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

    const isDraft = input.state === HOUSEHOLD_STATES.DRAFT;
    try {
      await this.memberRepo.createMembership({
        household_id: household.id,
        user_id: userId,
        role: isDraft ? HOUSEHOLD_ROLES.NANNY : HOUSEHOLD_ROLES.OWNER,
        // `can_edit` follows the role, not the authorship: the draft author
        // writes through the §2.2 capability, which no `can_edit` check has
        // any part in. Granting it here would be a right nobody reads today
        // and a surprise the day somebody does.
        can_edit: !isDraft,
        status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
      });
    } catch (error) {
      await this.rollbackOrphanedHousehold(household.id);
      throw error;
    }

    // Seed the federal holiday set, all observed — what makes the Holidays
    // group read "all on" the first time a parent opens it (080). Deliberately
    // NOT rolled back on failure, unlike the membership insert above: absence
    // means NOT observed, so a household with no holiday rows is a valid state
    // and every toggle is one PUT away from being right. A household with no
    // MEMBERS is unreachable forever. Log it and move on.
    try {
      await this.holidays.seedFederalSet(household.id);
    } catch (error) {
      logger.error('Failed to seed federal holidays for new household', {
        householdId: household.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return household;
  }

  /**
   * Set which federal holidays this household observes. Owner/parent only —
   * D-12's owner note is "configurable by the parent"; from 3-O the nanny may
   * PROPOSE terms, and a proposal is not a write to this table.
   *
   * Keys the payload does not name are LEFT ALONE (an upsert, never a
   * delete-then-insert), so an older client that knows ten of eleven holidays
   * cannot silently switch off the eleventh. The response is the FULL
   * post-write calendar rather than the touched rows, because the terms screen
   * renders the whole group.
   */
  async setHolidays(
    userId: string,
    householdId: string,
    input: SetHouseholdHolidaysRequest
  ): Promise<HouseholdHoliday[]> {
    const membership = await this.queries.getMembership(userId, householdId);
    this.assertWriteRole(householdId, membership);

    await this.holidays.upsertMany(householdId, input.holidays);
    return this.holidays.listForHousehold(householdId);
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
    // The draft author may set the NAME and nothing else (§2.2). She is asked
    // for it at the share moment, where it is finally known — every other
    // field on this body belongs to a family that does not exist yet, so a
    // non-parent naming one is refused before the capability is even consulted.
    if (
      !WRITE_ROLES.has(membership.role) &&
      Object.keys(input).some(key => key !== 'name')
    ) {
      throw new NotAHouseholdParentError(householdId, membership.role);
    }
    await this.assertWriteRoleOrDraftAuthor(householdId, membership);

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

  /**
   * Generate an invite code. Owner/parent, or the §2.2 draft author sending
   * her terms to a family she has just met.
   *
   * The PUBLIC LINK and the CODE expire on different clocks, and the split is
   * load-bearing rather than fussy (§6.1, D-51). `expires_at` keeps its 30 days
   * because a family may reasonably take three weeks to decide and she may read
   * the code out over the phone. `link_expires_at` defaults to 7, because the
   * web page is the surface carrying her RATE in the open and a month of live
   * URL is a month of exposure for a conversation usually over in a week. It is
   * one of the three conditions the rate is on that page at all — cutting it
   * takes the rate off the page (see 093's header and §6.2).
   *
   * From P8 the invite may also carry a non-binding pay OFFER (098). It is
   * stored, never acted on: it becomes a `terms_proposals` row only when a
   * nanny redeems the code, and dies with the invite if nobody does.
   *
   * `now` is injectable purely so the horizon boundary can be tested on both
   * sides of midnight; production callers never pass it (same convention as
   * `removeMember` and `leave`).
   */
  async createInvite(
    userId: string,
    householdId: string,
    input: CreateHouseholdInviteInput,
    now: () => Date = () => new Date()
  ): Promise<HouseholdInvite> {
    const membership = await this.queries.getMembership(userId, householdId);
    await this.assertWriteRoleOrDraftAuthor(householdId, membership);

    if (input.pay_offer) {
      await this.assertOfferable(householdId, input.role, input.pay_offer, now);
    }

    const code = await generateUniqueInviteCode(async candidate => {
      const existing = await this.inviteRepo.findByCode(candidate);
      return existing !== null;
    });

    // Computed here rather than defaulted in SQL so the two windows are set by
    // ONE writer: a database default plus a service override is how a 30-day
    // request silently lands on a 7-day row.
    const linkWindowDays =
      input.link_expires_in_days ?? DEFAULT_INVITE_LINK_WINDOW_DAYS;

    return this.inviteRepo.create({
      household_id: householdId,
      code,
      email: input.email ?? null,
      role: input.role,
      invited_by: userId,
      label: input.label ?? null,
      // Explicit null, not an omitted key: "no terms offered" is a fact about
      // this invite, and the house rule is that null means a stated no.
      pay_offer: input.pay_offer ?? null,
      link_expires_at: new Date(
        Date.now() + linkWindowDays * 24 * 60 * 60 * 1000
      ).toISOString(),
    });
  }

  /**
   * The two things an offer must satisfy before it is allowed onto an invite.
   *
   * ROLE. Pay is per-carer (D-21) and the only thing an offer can become is a
   * proposal scoped to the redeeming NANNY, so terms on a co-parent or helper
   * invite are a client bug. Refused rather than dropped: terms that silently
   * evaporate are the failure a parent would only notice weeks later, when the
   * nanny asks what she is being paid.
   *
   * HORIZON. Checked HERE and not only at promotion, for the same reason
   * `termsProposalCommandService.validateTerms` checks it at proposal time
   * rather than at acceptance: he can fix a fat-fingered year while his hands
   * are still on the keyboard. A date already past the horizon here would be
   * dropped at redemption — the code would work, and the terms would not
   * arrive.
   */
  private async assertOfferable(
    householdId: string,
    role: string,
    offer: { valid_from: string },
    now: () => Date
  ): Promise<void> {
    if (role !== HOUSEHOLD_ROLES.NANNY) {
      throw new PayOfferNotForRoleError(role);
    }
    const household = await this.householdRepo.findById(householdId);
    if (
      !isWithinFutureHorizon(
        offer.valid_from,
        household?.timezone ?? 'UTC',
        now()
      )
    ) {
      throw new TermsProposalValidationError('VALID_FROM_TOO_FAR_IN_FUTURE', {
        householdId,
        validFrom: offer.valid_from,
      });
    }
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
    input: RedeemHouseholdInviteBody,
    now: () => Date = () => new Date()
  ): Promise<HouseholdMember> {
    // Same FK as `create`, and this path has no client-side bootstrap at all:
    // a nanny's first ever API call can be this one.
    await this.users.ensureProfile(userId);

    const code = input.code.trim().toUpperCase();
    const invite = await this.inviteRepo.findByCode(code);
    if (!invite) {
      throw new InviteNotFoundError(code);
    }

    // A nanny-authored code redeems through 094 instead, because everything it
    // has to do — instantiate or absorb, join two people, copy children and the
    // proposal, claim the code — has to commit or roll back together. The
    // parent-authored path below is UNCHANGED: same claim, same reactivation,
    // same PTO carry-over, same self-heal.
    const inviteHousehold = await this.householdRepo.findById(
      invite.household_id
    );
    if (inviteHousehold?.state === HOUSEHOLD_STATES.DRAFT) {
      const membership = await this.redeemDraftInvite(
        userId,
        code,
        input,
        invite
      );
      if (membership) {
        return membership;
      }
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

    // EVERY status, `candidate` included: a removed ex-member still owns a
    // membership row, so the unique `(household_id, user_id)` constraint makes
    // a fresh insert impossible for them. Active is the only state that refuses
    // here, and it refuses BEFORE the claim so a no-op never burns a single-use
    // code. `findMembershipAnyStatus` would be wrong now — it excludes a
    // candidate, whose row is just as unique-constraint-fatal as a removed one.
    const existingMembership =
      await this.memberRepo.findMembershipIncludingCandidate(
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

    await this.promoteOfferToProposal(invite, userId, now);

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
   * P8 — turn the inviting parent's pay OFFER into a real terms proposal she
   * can answer. The mirror of D-38: a nanny's draft proposal is CLONED into
   * the family's household on redemption (096), and a parent's offer is
   * PROMOTED into hers. One mechanism, two directions, and neither side's
   * terms become money until the other side accepts.
   *
   * ================================================================
   * NOTHING HERE MAY THROW. THAT IS THE WHOLE DESIGN.
   * ================================================================
   *
   * By the time this runs she has claimed the code and her membership row
   * exists. The claim is single-use and already burned — there is no
   * compensation left to run and no second attempt she could make. A throw
   * from here would therefore strand a real nanny OUTSIDE a household she
   * legitimately joined, holding a code that no longer works, and the thing
   * lost would be a rate she has not agreed to yet. Every failure below costs
   * a proposal and never the join; the worst outcome is that she lands exactly
   * where she would have without P8, and a parent proposes terms the ordinary
   * way from the pay screen.
   *
   * The three cases, in the order they are reached:
   *
   * - NO PARENT LEFT TO NAME. 009 declares `invited_by ... on delete set
   *   null`, and 092 makes `proposed_by` NOT NULL. There is nobody honest to
   *   put in that column, so there is no proposal to write.
   * - A STALE START DATE. An invite lives 30 days, so terms written near the
   *   12-month horizon can be out of reach by the time she types the code.
   *   The parent's date is never rewritten to make it fit (§7.4: the record
   *   says what was agreed) — the promotion is skipped and logged.
   * - AN OPEN ROUND ALREADY EXISTS. `OpenTermsProposalExistsError`, which the
   *   repository translates from a 23505 by NAMING 092's partial index rather
   *   than trusting the bare code (GOLDEN-FIXES #31). They are already
   *   negotiating; a second round is not this path's to open.
   *
   * NO PUSH, DELIBERATELY. She is by construction inside the app at this
   * instant — she just typed the code — and the proposal is on her Today
   * screen before the notification could land. The `INVITE_REDEEMED` push to
   * the PARENTS is untouched below and still fires; only the redundant one to
   * her is omitted.
   */
  private async promoteOfferToProposal(
    invite: HouseholdInvite,
    carerId: string,
    now: () => Date
  ): Promise<void> {
    const offer = invite.pay_offer;
    if (invite.role !== HOUSEHOLD_ROLES.NANNY || !offer) {
      return;
    }

    try {
      const proposedBy = invite.invited_by;
      if (!proposedBy) {
        logger.info('Pay offer not promoted — the inviting parent is gone', {
          inviteId: invite.id,
        });
        return;
      }

      const household = await this.householdRepo.findById(invite.household_id);
      if (
        !isWithinFutureHorizon(
          offer.valid_from,
          household?.timezone ?? 'UTC',
          now()
        )
      ) {
        logger.info('Pay offer not promoted — valid_from is past the horizon', {
          inviteId: invite.id,
          validFrom: offer.valid_from,
        });
        return;
      }

      const profile = await this.users.getProfileById(carerId);
      await this.proposals.create({
        household_id: invite.household_id,
        carer_id: carerId,
        // The parent who WROTE the terms, not the person who typed the code.
        // §10 renders this as the actor in every state line, and she must not
        // be shown as the author of terms she is being asked to accept.
        proposed_by: proposedBy,
        direction: TERMS_PROPOSAL_DIRECTIONS.PARENT,
        terms: offer,
        // He wrote these before he had met her; there is nothing addressed to
        // her to carry, and an invented note would be words he never typed.
        note: null,
        // A first round by definition — nothing existed here to answer.
        supersedes_id: null,
        from_invite_id: invite.id,
        // 033 discipline: snapshot at insert so the negotiation stays legible
        // after her profile is gone. Same 'Carer' literal the pay domain and
        // `termsProposalCommandService` fall back to.
        carer_display_name: profile?.name ?? UNNAMED_CARER_DISPLAY_NAME,
        // `status` is deliberately absent: 092 defaults it to 'proposed', and
        // `termsProposalCommandService.propose` omits it for the same reason.
      });
    } catch (error) {
      if (error instanceof OpenTermsProposalExistsError) {
        logger.info('Pay offer not promoted — a round is already open', {
          inviteId: invite.id,
          householdId: invite.household_id,
          carerId,
        });
        return;
      }
      logger.error('Pay offer promotion failed — the join stands', {
        inviteId: invite.id,
        householdId: invite.household_id,
        carerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The draft arm of `redeemInvite`. Returns the membership 094 created, or
   * `null` to mean "not a draft after all — run the ordinary path".
   *
   * Every refusal below is 094's `outcome`, mapped to an error this API
   * already has. Four of them collapse into the SAME opaque
   * `InviteNotFoundError` a missing code gets, and that is the existence-hiding
   * convention `previewInvite`'s header protects (§17): "you may not absorb
   * into that household", "that is your own code" and "the draft has no
   * author" all confirm the code was real to somebody probing strings. The
   * reason travels in the metadata, where support can read it and a stranger
   * cannot.
   */
  private async redeemDraftInvite(
    userId: string,
    code: string,
    input: RedeemHouseholdInviteBody,
    invite: HouseholdInvite
  ): Promise<HouseholdMember | null> {
    const result = await this.inviteRepo.redeemDraftHousehold(
      code,
      userId,
      // "No live household of my own" is null, which 094 reads as
      // "instantiate one from the draft" (§2.1 row 1).
      input.target_household_id ?? null,
      // D-8. Only the instantiate branch reads it; null there means "keep the
      // draft's value", which is 075's default. See the schema's note for why
      // the redeemer's device is the honest source for an FLSA workweek.
      input.week_starts_on ?? null
    );

    switch (result.outcome) {
      case 'redeemed':
        this.notifyDraftRedemption(
          result.household_id,
          userId,
          result,
          await this.familyNameForCarerPush(invite, result.household_id)
        );
        // 094's `membership` field is the NANNY row it just inserted (the
        // carer join), not the redeemer's. Ordinary redeemInvite returns the
        // caller's membership so CodeEntryScreen can resolve setup role —
        // returning the carer's row here made a joining parent land on
        // Availability (nanny sequence) instead of notifications. Always
        // hand back the redeemer's own active row (owner on instantiate,
        // their existing parent/owner row on absorb).
        return this.queries.getMembership(userId, result.household_id);
      case 'not_a_draft_invite':
        // The household went live between our read and the call — impossible
        // today (094 is the only writer of that transition and it does not
        // reach here), kept because falling through is free and correct.
        return null;
      case 'already_member':
        throw new AlreadyMemberError(result.household_id);
      case 'proposal_already_open':
        // Two of her codes redeemed by the same family. Nothing is being
        // hidden here — he knows who she is — so this one is nameable.
        throw new ConflictError(
          'These terms are already with this family to review',
          'PROPOSAL_ALREADY_OPEN',
          { householdId: result.household_id }
        );
      default:
        // The reason is LOGGED, never returned: `BaseError` ships `metadata`
        // to the client on a 4xx, and "you may not absorb into that household"
        // versus "that is your own code" versus "no such code" is exactly the
        // distinction §17's existence-hiding convention refuses to draw for
        // somebody holding a string.
        logger.info('Draft redemption refused', {
          code,
          outcome: result.outcome,
        });
        throw new InviteNotFoundError(code);
    }
  }

  /**
   * Both arms of `invite_redeemed` on a draft redemption (§13 — the type is
   * widened to audience `both`, not split into a second type: one fact, one
   * type, two arms of copy).
   *
   * The CARER arm is the new one and the important one. She is not present when
   * this happens — she shared a link days ago — and "did it reach them" is the
   * only question she has between sending her terms and hearing back. The
   * payload carries `proposalId` so the mobile route map can fork on role and
   * land her on the proposal rather than on a household she cannot read yet.
   *
   * NO FIGURE in either body (A8, §13): a lock screen is a public surface, and
   * the one on this path would be her rate.
   */
  private notifyDraftRedemption(
    householdId: string,
    redeemerId: string,
    result: { carer_id: string; proposal: { id: string } | null },
    familyName: string
  ): void {
    try {
      notifyHouseholdParents(
        householdId,
        {
          title: 'Someone joined your household',
          body: 'A code was redeemed — a new nanny joined the household.',
          data: {
            type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
            householdId,
          },
        },
        // The redeemer just tapped the button and is looking at the result;
        // a co-parent who was not there is the one who needs telling.
        { excludeUserId: redeemerId }
      );
    } catch {
      // Fire-and-forget, like every other push in this service: the membership
      // is already committed and must not be undone by a notification.
    }

    try {
      notifyUser(result.carer_id, {
        title: 'Someone joined with your code',
        body: `${familyName} joined with your code. Your terms are with them to review.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          householdId,
          ...(result.proposal ? { proposalId: result.proposal.id } : {}),
        },
      });
    } catch {
      // Same posture as the parent arm above.
    }
  }

  /**
   * How the carer's push names the family — HER label first.
   *
   * `invite.label` is the name she typed at the share moment ("The Bakers").
   * It is private to her, and she is the recipient of this push, so it is both
   * permitted and the best answer: on the instantiate path the household's own
   * `name` is whatever 094 fell back to, which may be "Our household" and
   * reads as nonsense in this sentence.
   *
   * Never throws and never blocks the redemption: a name is a nicety on a push
   * and the membership is already committed.
   */
  private async familyNameForCarerPush(
    invite: HouseholdInvite,
    householdId: string
  ): Promise<string> {
    if (invite.label) {
      return invite.label;
    }
    try {
      const household = await this.householdRepo.findById(householdId);
      return household?.name ?? 'A family';
    } catch {
      return 'A family';
    }
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

  /**
   * Revoke a pending invite so its code stops working — and, from 3-O, so the
   * public terms page dies with it. Owner/parent, or the §2.2 draft author:
   * the per-row off switch is the FIRST of Marisol's three conditions for her
   * rate being on that page (D-51), and an off switch she cannot reach is not
   * one.
   */
  async revokeInvite(
    callerId: string,
    householdId: string,
    inviteId: string
  ): Promise<HouseholdInvite> {
    const membership = await this.queries.getMembership(callerId, householdId);
    await this.assertWriteRoleOrDraftAuthor(householdId, membership);

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
   * The role gate, widened by exactly the §2.2 draft-author capability and
   * nothing else. See `isDraftAuthor` for why it is a predicate beside
   * `WRITE_ROLES` rather than a fifth member of it.
   *
   * The household read only happens when the role gate has ALREADY failed —
   * which today means a nanny or helper, i.e. a request that used to throw
   * outright. Every parent-authored write keeps its old query count.
   */
  private async assertWriteRoleOrDraftAuthor(
    householdId: string,
    membership: HouseholdMember
  ): Promise<void> {
    if (WRITE_ROLES.has(membership.role)) {
      return;
    }
    const household = await this.householdRepo.findById(householdId);
    if (isDraftAuthor(household, membership)) {
      return;
    }
    throw new NotAHouseholdParentError(householdId, membership.role);
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

    const claimerMembership =
      await this.memberRepo.findMembershipIncludingCandidate(
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

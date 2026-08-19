/**
 * Household query service (CQRS-lite: reads only). Ownership here is
 * MEMBERSHIP, not an `owner_id` column — a household has an owner, possibly a
 * co-parent, one or more nannies, and maybe a view-only helper, and a nanny
 * belongs to several households. The repository is injectable so unit tests
 * can pass mocks.
 *
 * @module domains/household/services/householdQueryService
 */
import { logger } from '../../../middlewares/logger';
import { TermsProposalRepository } from '../../termsProposal/repositories/termsProposalRepository';
import {
  HouseholdNotFoundError,
  InviteNotFoundError,
  NotAHouseholdParentError,
} from '../errors/householdErrors';
import { HouseholdCustomHolidayRepository } from '../repositories/householdCustomHolidayRepository';
import { HouseholdHolidayRepository } from '../repositories/householdHolidayRepository';
import { HouseholdInviteRepository } from '../repositories/householdInviteRepository';
import { HouseholdMemberRepository } from '../repositories/householdMemberRepository';
import { HouseholdRepository } from '../repositories/householdRepository';
import {
  HOUSEHOLD_INVITE_STATUSES,
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_STATES,
} from '../schemas';
import type {
  Household,
  HouseholdCustomHoliday,
  HouseholdHoliday,
  HouseholdInvite,
  HouseholdMember,
  InvitePreview,
  TermsPreviewSource,
} from '../types';
import {
  HOUSEHOLD_WRITE_ROLES,
  isDraftAuthor,
} from '../utils/assertHouseholdRole';

export class HouseholdQueryService {
  constructor(
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly inviteRepo: HouseholdInviteRepository = new HouseholdInviteRepository(),
    private readonly holidayRepo: HouseholdHolidayRepository = new HouseholdHolidayRepository(),
    // The repository directly, never the terms-proposal domain's services or
    // barrel: those reach back here for membership, and the import would close
    // a cycle. `termsProposalRepository` imports nothing from this domain.
    private readonly proposalRepo: Pick<
      TermsProposalRepository,
      'findOpenForCarer'
    > = new TermsProposalRepository(),
    private readonly customHolidayRepo: Pick<
      HouseholdCustomHolidayRepository,
      'listForHousehold'
    > = new HouseholdCustomHolidayRepository()
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

  /**
   * List a household's member roster for display and client-side fan-out reads.
   * Caller must already be a member.
   *
   * Returns `active` and `candidate` rows, not `removed`. The mobile inbox
   * fans terms-proposal queries from this list, and D-38 leaves a nanny a
   * `candidate` until acceptance — precisely when the parent must see her
   * proposal. Push audiences and shift authorization still resolve through
   * `listActiveByHousehold`, not here.
   *
   * THIS IS ALSO THE ONE PLACE A PHONE NUMBER IS EXPOSED (099).
   * `user_profiles` RLS is owner-only and stays that way; a member's number
   * rides out on the repository's profile embed as `profile_phone`, and both
   * halves of the exposure rule are enforced right here:
   *
   * - The CALLER must be an ACTIVE member — `getMembership` resolves through
   *   `findActiveMembership`, so a removed or candidate caller gets
   *   `HouseholdNotFoundError` and no roster at all.
   * - The SUBJECT must be an ACTIVE member — every other row keeps its place
   *   in the list (the inbox fans proposal queries from candidates) but loses
   *   its number. A candidate has redeemed a code and is waiting on terms;
   *   neither side has agreed to be reachable by the other yet.
   *
   * The subject test is POSITIVE (`=== ACTIVE`), never `!== 'candidate'`, for
   * the reason `HOUSEHOLD_MEMBER_STATUSES`' own comment gives: a status added
   * tomorrow must be silent by construction rather than by somebody
   * remembering to exclude it.
   */
  async listMembers(
    userId: string,
    householdId: string
  ): Promise<HouseholdMember[]> {
    await this.getMembership(userId, householdId);
    const members =
      await this.memberRepo.listNonRemovedByHousehold(householdId);
    return members.map(member =>
      member.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE
        ? member
        : { ...member, profile_phone: null }
    );
  }

  /**
   * Every invite this household has minted. PARENTS ONLY (or the §2.2 draft
   * author) — the same gate the create and revoke writes use, for a stronger
   * reason than symmetry: each row carries a live `code`, and a code is a
   * bearer token for joining this family. A nanny who could read this list
   * could mint herself a second membership, or hand the family's open code to
   * somebody else.
   *
   * `status` is REPAIRED on read: nothing flips a `pending` row to `expired`
   * on a schedule, so a code whose `expires_at` has passed is still literally
   * `pending` in the table while being dead at redeem time (the redeem path
   * checks the clock, not the column). Reporting that row as "waiting" would
   * be the app telling a parent to keep waiting on a code that can no longer
   * work. Derive it here, once, rather than leaving every reader to remember
   * the clock — and do NOT write the repair back: the column is the audit of
   * what was decided, and expiry is not a decision anybody made.
   */
  async listInvites(
    userId: string,
    householdId: string,
    now: () => Date = () => new Date()
  ): Promise<HouseholdInvite[]> {
    const membership = await this.getMembership(userId, householdId);
    if (!HOUSEHOLD_WRITE_ROLES.has(membership.role)) {
      const household = await this.householdRepo.findById(householdId);
      if (!isDraftAuthor(household, membership)) {
        throw new NotAHouseholdParentError(householdId, membership.role);
      }
    }

    const invites = await this.inviteRepo.listByHousehold(householdId);
    const nowMs = now().getTime();
    return invites.map(invite =>
      invite.status === HOUSEHOLD_INVITE_STATUSES.PENDING &&
      // GOLDEN-FIXES #25: never compare two timestamp STRINGS. PostgREST
      // returns `+00:00` where JS writes `.000Z`, and they sort differently.
      new Date(invite.expires_at).getTime() <= nowMs
        ? { ...invite, status: HOUSEHOLD_INVITE_STATUSES.EXPIRED }
        : invite
    );
  }

  /**
   * The household's holiday calendar. ANY active member, nanny included: what
   * the family observes is a term of her employment and she is entitled to
   * read it (080's select policy, spec §2). Writes stay parent-only, in the
   * command service.
   *
   * An empty list is a real answer, not a missing one — no row means nothing
   * agreed, which is NOT observed.
   */
  async listHolidays(
    userId: string,
    householdId: string
  ): Promise<HouseholdHoliday[]> {
    await this.getMembership(userId, householdId);
    return this.holidayRepo.listForHousehold(householdId);
  }

  /**
   * The household's authored custom days. ANY active member, nanny included:
   * same read gate as `listHolidays`. Writes stay parent-only, in the
   * command service. An empty list is a real answer — no custom days.
   */
  async listCustomHolidays(
    userId: string,
    householdId: string
  ): Promise<HouseholdCustomHoliday[]> {
    await this.getMembership(userId, householdId);
    return this.customHolidayRepo.listForHousehold(householdId);
  }

  /**
   * Preview an invite by its code — deliberately NOT membership-gated (the
   * redeemer isn't a member yet). Returns only the household name, active
   * children's first names, and the proposed role; nothing else.
   *
   * Only a LIVE code previews. This is the one unauthenticated read in the
   * domain, so a code that grants nothing must disclose nothing: answering for
   * a revoked one is the worst case, since revoking is precisely how a parent
   * takes access back, and an accepted or expired one is a code whose holder
   * has no claim on the family's name or their children's names either.
   *
   * Both refusals are the SAME InviteNotFoundError a missing code gets — the
   * domain's existence-hiding convention (see the error's doc comment): naming
   * the reason confirms the code was real.
   *
   * `redeemInvite` reports the reasons separately, and that asymmetry is
   * deliberate rather than an oversight — a redeemer is acting on a code
   * somebody actually sent them and needs to know whether to ask for a new one,
   * where a previewer may simply be typing strings. What is shared is the
   * TEST for liveness, expiry included: nothing flips `status` to 'expired' on
   * a schedule, so a status check alone would let every long-dead pending row
   * keep previewing.
   */
  async previewInvite(code: string): Promise<InvitePreview> {
    const invite = await this.inviteRepo.findByCode(code);
    if (!invite) {
      throw new InviteNotFoundError(code);
    }
    if (
      invite.status !== HOUSEHOLD_INVITE_STATUSES.PENDING ||
      new Date(invite.expires_at).getTime() < Date.now()
    ) {
      throw new InviteNotFoundError(code);
    }
    const household = await this.householdRepo.findById(invite.household_id);
    if (!household) {
      throw new InviteNotFoundError(code);
    }

    // A NANNY-AUTHORED DRAFT answers, but with a different set of facts,
    // because a draft has none of the ones this endpoint was written to give.
    //
    // `household_state` is what §8.2's confirm sheet fires on: redeeming her
    // code ABSORBS her into the redeemer's own household rather than joining
    // him to hers, and "the redeemer already has a household" cannot tell that
    // apart from an ordinary co-parent invite to a second family. The client
    // cannot derive it, so the server says it.
    //
    // What it must NOT answer with: the "children" in a draft are placeholders
    // SHE typed while pricing her own week — not this family's children, and
    // rendering them as though they were is worse than saying nothing. There
    // is no family name either; a draft is `name = null` by 093's CHECK.
    if (household.state === HOUSEHOLD_STATES.DRAFT) {
      const proposal = household.created_by
        ? await this.proposalRepo.findOpenForCarer(
            household.id,
            household.created_by
          )
        : null;
      return {
        household_name: '',
        children_first_names: [],
        role: invite.role,
        household_state: HOUSEHOLD_STATES.DRAFT,
        // The same helper `termsPreview` uses, so the sheet and the public page
        // cannot introduce her by two different names.
        carer_name: proposal
          ? firstNameLastInitial(proposal.carer_display_name)
          : null,
      };
    }

    const childrenFirstNames =
      await this.householdRepo.listActiveChildFirstNames(invite.household_id);
    return {
      // Non-null for a live household by 093's `households_live_has_name`
      // CHECK; the fallback is for the type, not for a case that can happen.
      household_name: household.name ?? '',
      children_first_names: childrenFirstNames,
      role: invite.role,
      household_state: HOUSEHOLD_STATES.LIVE,
      carer_name: null,
    };
  }

  /**
   * The public terms page's data (§6.2) — UNAUTHENTICATED, because the code
   * IS the bearer secret and nothing else guards this.
   *
   * THE 404 TABLE IS THE CONTRACT, and every row below returns the SAME opaque
   * `InviteNotFoundError` `previewInvite` uses. That convention is not relaxed
   * for a nicer error: naming the reason confirms the code was real to
   * somebody typing strings, and the worker renders one page — "This link
   * isn't active any more. Ask for a new one." — in every case.
   *
   * Two of these rows are not merely correctness. The rate is on that page
   * only because Marisol cleared it on three standing conditions (D-51): a
   * per-invite off switch she controls, a short-lived public link, and the page
   * DEAD the instant the code is redeemed. The `status !== 'pending'` and
   * `link_expires_at` checks below are two of the three. Cutting either takes
   * the rate off the page and re-opens the owner decision — it does not
   * silently degrade.
   *
   * What crosses the wire is deliberately thin: her first name and last
   * initial, her terms, the code. Never the children's names, the family's
   * name, her surname, an address or any contact detail — and never her
   * private recipient label, which is hers alone (§6.1).
   */
  async termsPreview(code: string): Promise<TermsPreviewSource> {
    /**
     * The reason goes to the LOG, never into the error. `BaseError`'s
     * client-safe serialisation ships `metadata` on a 4xx (BaseError.ts:64),
     * which is right where the reason is a private detail for a member and
     * wrong here: this caller is anonymous, and "expired" versus "no such
     * code" is precisely the distinction §6.2 refuses to draw. One page, one
     * message, and support still gets the answer from the log line.
     */
    const refuse = (reason: string): never => {
      // The REASON is logged; the CODE is not. On this one route the code is
      // the bearer secret — anyone holding it reads her pay terms — and
      // `reason: 'code_expired'` beside a code is a log line confirming that
      // code was real. An anonymous caller can spend guesses here, so every
      // guess would otherwise write a candidate secret into the log. Support
      // still gets the row of §6.2's table that fired, correlated by
      // `requestId` like every other line.
      logger.info('Public terms preview refused', { reason });
      throw new InviteNotFoundError(code);
    };

    const invite = await this.inviteRepo.findByCode(code);
    if (!invite) {
      return refuse('no_such_code');
    }
    // Redeemed, revoked, or a code somebody already used: one test, and it
    // fires the INSTANT redemption flips the status.
    if (invite.status !== HOUSEHOLD_INVITE_STATUSES.PENDING) {
      return refuse('not_pending');
    }
    // The code's own 30 days. Nothing flips `status` to 'expired' on a
    // schedule, so a status check alone would keep every long-dead row alive.
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return refuse('code_expired');
    }
    // The PAGE's separate, shorter clock. A null means an invite minted before
    // this window existed — which is a parent-authored one, refused below
    // anyway — and "no window" reads as closed, never as open forever.
    if (
      !invite.link_expires_at ||
      new Date(invite.link_expires_at).getTime() < Date.now()
    ) {
      return refuse('link_expired');
    }

    const household = await this.householdRepo.findById(invite.household_id);
    if (!household || household.state !== HOUSEHOLD_STATES.DRAFT) {
      return refuse('not_a_draft_invite');
    }
    // The draft's author is the carer whose terms these are — read from
    // `created_by` for the same reason 094 does, and her proposal is the one
    // open round in her own draft.
    const proposal = household.created_by
      ? await this.proposalRepo.findOpenForCarer(
          household.id,
          household.created_by
        )
      : null;
    if (!proposal) {
      return refuse('no_open_proposal');
    }

    return {
      code: invite.code,
      carer_name: firstNameLastInitial(proposal.carer_display_name),
      proposed_at: proposal.created_at,
      link_expires_at: invite.link_expires_at,
      // An explicit `terms.currency` still wins downstream; this is the
      // household's, the same resolution the arrangement write makes.
      currency: household.currency,
      proposal,
    };
  }
}

/**
 * "Marisol Mendez" -> "Marisol M." (§6.2: her first name and last initial
 * only). A single-word name is returned as-is rather than initialled away —
 * "Marisol" is already less than her full name, and "M." on its own names
 * nobody.
 */
function firstNameLastInitial(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return parts[0] ?? '';
  }
  const first = parts[0];
  const last = parts[parts.length - 1] ?? '';
  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

// Singleton for controllers/routes that don't need DI.
export const householdQueryService = new HouseholdQueryService();

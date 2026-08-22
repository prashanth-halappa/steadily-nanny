/**
 * Household command service (CQRS-lite: writes). Role checks live here, one
 * line at the top of each method — this is the slot the deleted widget
 * example's entitlement gate used to occupy. household_members is checked,
 * not an `owner_id` column: a household has an owner, a co-parent, one or
 * more nannies, and maybe a helper, and a nanny belongs to several households.
 *
 * @module domains/household/services/householdCommandService
 */
// Straight from the shared package, not via the terms-proposal domain: that
// package is a leaf and imports nothing of ours, so there is no cycle to dodge.

import {
  holidayKeysForCountry,
  isHolidayKeyForCountry,
} from '@steadily-nanny/shared-types/holidayPacks';
import {
  MEMBERSHIP_ENDED_REASONS,
  PAY_OFFER_PROMOTION_OUTCOMES,
  type PayOfferPromotionOutcome,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { TERMS_PROPOSAL_DIRECTIONS } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { ConflictError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { invalidateResourceRelationshipCache } from '../../../utils/cache';
// TYPE ONLY, same cycle as the schedule import below: the detection module
// reaches `uncoveredCareService`, which imports the household barrel, which
// constructs this service. Verified the same way — the value import fails at
// boot with "Cannot access 'HouseholdMemberRepository' before initialization".
import type { DetectUncoveredCareArgs } from '../../child/services/detectUncoveredCareForDate';
import { notifyHouseholdParents, notifyUser } from '../../notification';
// Repository modules directly, NOT the domain barrels: a barrel pulls in that
// domain's services, and one of those reaching back for household membership
// would close an import cycle.
import { PayArrangementRepository } from '../../pay/repositories/payArrangementRepository';
import { PtoLedgerRepository } from '../../pay/repositories/ptoLedgerRepository';
// The schedule LEAF modules, never `../../schedule`: the barrel pulls that
// domain's services, and `schedulePatternCommandService` reaches back here for
// household membership — the cycle this file's import note at the top warns
// about.
// TYPE ONLY, and the lazy loader below is why. A value import here closes a
// cycle at boot: schedulePatternCommandService -> notification ->
// the household barrel -> this file. Verified, not theorised — it fails with
// "Cannot access 'HouseholdMemberRepository' before initialization". This is
// the same trap `userService.endAcceptedPatterns` documents for the same
// method, reached from the other side.
import type { schedulePatternCommandService } from '../../schedule/services/schedulePatternCommandService';
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
  HouseholdHasCarerError,
  HouseholdNotFoundError,
  InviteAlreadyAcceptedError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteNotPendingError,
  InviteRevokedError,
  MemberHasRunningEntryError,
  MemberNotFoundError,
  NotAHouseholdParentError,
  ParentAlreadyHasHouseholdError,
  PayOfferNotForDraftHouseholdError,
  PayOfferNotForRoleError,
  UnknownHolidayKeyError,
  WeekStartLockedError,
} from '../errors/householdErrors';
import { HouseholdCustomHolidayRepository } from '../repositories/householdCustomHolidayRepository';
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
  PARENT_ROLES,
} from '../schemas';
import type {
  CreateHouseholdInput,
  CreateHouseholdInviteInput,
  Household,
  HouseholdCustomHoliday,
  HouseholdHoliday,
  HouseholdInvite,
  HouseholdMember,
  RedeemHouseholdInviteBody,
  SetHouseholdCustomHolidaysRequest,
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
 * The departure teardown, resolved at CALL time rather than import time.
 *
 * A constructor default is evaluated eagerly, so defaulting straight to
 * `schedulePatternCommandService` would need a value import — and that import
 * closes a cycle at boot (see the type-only import at the top of this file).
 * Deferring it to the first call breaks the cycle without giving up injection:
 * a test still passes its own object and never reaches this.
 *
 * One method, matching the injected `Pick`, so the seam stays honest.
 */
/**
 * Uncovered-care detection, resolved at call time for the same cycle reason as
 * `lazySchedulePatterns` below.
 *
 * Stays `void`-returning so callers cannot accidentally await it: the
 * membership row is already committed by the time this runs, and a detection
 * failure must never propagate back into the write. The import itself can fail
 * too, so that is caught here rather than becoming an unhandled rejection.
 */
const lazyDetectUncovered = (args: DetectUncoveredCareArgs): void => {
  void import('../../child/services/detectUncoveredCareForDate')
    .then(m => m.detectUncoveredCareBestEffort(args))
    .catch(error => {
      logger.error('Uncovered-care recompute could not be loaded', {
        householdId: args.householdId,
        localDate: args.localDate,
        error: error instanceof Error ? error.message : String(error),
      });
    });
};

const lazySchedulePatterns = {
  async endAcceptedPatternsForCarer(
    householdId: string,
    carerId: string,
    now?: Date
  ): Promise<string[]> {
    const { schedulePatternCommandService } = await import(
      '../../schedule/services/schedulePatternCommandService'
    );
    return schedulePatternCommandService.endAcceptedPatternsForCarer(
      householdId,
      carerId,
      now
    );
  },
};

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
      'upsertMany' | 'listForHousehold' | 'seedCountryPack' | 'deleteKeysNotIn'
    > = new HouseholdHolidayRepository(),
    // P8's promotion target, and F8's withdrawal on removal/leave. The
    // REPOSITORY, never the terms-proposal domain barrel — see the import
    // note at the top of this file.
    private readonly proposals: Pick<
      TermsProposalRepository,
      'create' | 'withdrawOpenForCarer'
    > = new TermsProposalRepository(),
    private readonly customHolidays: Pick<
      HouseholdCustomHolidayRepository,
      'replaceSet'
    > = new HouseholdCustomHolidayRepository(),
    // The departure-side pattern teardown, now ONE method rather than the
    // repository+materialisation pair each caller used to drive itself. LAST
    // parameters and defaulted, so every existing positional construction
    // keeps working.
    private readonly schedulePatterns: Pick<
      typeof schedulePatternCommandService,
      'endAcceptedPatternsForCarer'
    > = lazySchedulePatterns,
    // Injected so a test can assert the recompute without reaching a database.
    // `detectUncoveredCareBestEffort` is void by design: it is fire-and-forget
    // and swallows its own failures.
    private readonly detectUncovered: (
      args: DetectUncoveredCareArgs
    ) => void = lazyDetectUncovered
  ) {}

  /**
   * Re-run uncovered-care detection for the days a departure just emptied.
   *
   * Membership change is NOT one of the detection triggers
   * (`docs/12-NEED-COVERAGE.md`), and `detectUncoveredCareForDate` counts any
   * shift with a `carer_id` as covered — so without this the family's calendar
   * still shows the departed carer on Tuesday, the day never reads as
   * uncovered, and the parents learn nothing until the 03:00 sweep. They go to
   * bed believing they have childcare.
   *
   * `cause: 'cancelled'` because that is literally what happened to the shifts
   * these dates came from. Best-effort per date and AFTER the membership flip:
   * the row is already committed, and a detection failure must never undo it.
   */
  private raiseUncoveredForVacatedDates(
    householdId: string,
    localDates: readonly string[],
    actorId: string
  ): void {
    for (const localDate of localDates) {
      this.detectUncovered({
        householdId,
        localDate,
        cause: 'cancelled',
        actorId,
      });
    }
  }

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
    const isDraft = input.state === HOUSEHOLD_STATES.DRAFT;
    // §8/A4 — one live family per parent. A DRAFT is exempt and must stay
    // exempt: it is nanny-authored, its only membership is `role='nanny'`, and
    // guarding it would stop a nanny who works for a family from ever writing
    // her own terms. Checked BEFORE the household insert, so a refusal leaves
    // nothing half-created to roll back.
    if (!isDraft) {
      await this.assertNoOtherLiveParentHousehold(userId);
    }

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

    // Seed the country's holiday pack, all observed — what makes the Holidays
    // group read "all on" the first time a parent opens it (080, 107).
    // Deliberately NOT rolled back on failure, unlike the membership insert
    // above: absence means NOT observed, so a household with no holiday rows
    // is a valid state and every toggle is one PUT away from being right. A
    // household with no MEMBERS is unreachable forever. Log it and move on.
    try {
      await this.holidays.seedCountryPack(household.id, household.country);
    } catch (error) {
      logger.error('Failed to seed holidays for new household', {
        householdId: household.id,
        country: household.country,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return household;
  }

  /**
   * The LIVE households this user speaks for, as a parent — the set §8's
   * "one household per parent" is a cap on.
   *
   * Two reads, both existing ones, in the only order that is cheap: membership
   * first (`listActiveByUser`, one query, already the shape the mobile app
   * learns its own roles from), filtered to `PARENT_ROLES` in memory, then a
   * single `listLiveIds` over whatever survives. A carer-only user pays for
   * the first query and nothing else, which is the common case by a distance.
   *
   * ACTIVE memberships only, deliberately: a household the caller was removed
   * from — or ARCHIVED, which is the same row state (see `archive`) — is not
   * one he speaks for any more, and must not block him joining another.
   */
  private async liveParentHouseholdIds(
    userId: string,
    exceptHouseholdId?: string
  ): Promise<string[]> {
    const memberships = await this.memberRepo.listActiveByUser(userId);
    const candidateIds = memberships
      .filter(
        m => PARENT_ROLES.has(m.role) && m.household_id !== exceptHouseholdId
      )
      .map(m => m.household_id);
    if (candidateIds.length === 0) {
      return [];
    }
    return this.householdRepo.listLiveIds(candidateIds);
  }

  /**
   * §8/A4 — refuse if this user already speaks for a live family.
   *
   * The constraint has to live HERE and not in a dialog: `redeemInvite` and
   * `create` would both happily write a second parent membership, and the
   * household the parent silently abandons is the one holding a nanny's
   * schedule, her hours and her pay history. A sheet that can be dismissed is
   * a suggestion.
   *
   * The error NAMES the household in the way — it is the caller's own, so
   * nothing leaks, and the escape hatch ("invite them to {existingName}
   * instead") cannot be offered without it.
   */
  async assertNoOtherLiveParentHousehold(
    userId: string,
    exceptHouseholdId?: string
  ): Promise<void> {
    const existing = (
      await this.liveParentHouseholdIds(userId, exceptHouseholdId)
    )[0];
    if (existing) {
      throw new ParentAlreadyHasHouseholdError(existing);
    }
  }

  /**
   * Close a household the caller is done with — ARCHIVE, never delete. Hours,
   * timesheets and pay history are the product (A4), and a nanny's record of
   * what she was owed must outlive the family's decision to move on.
   *
   * ================================================================
   * ARCHIVED == THE CALLER'S OWN MEMBERSHIP SET TO `removed`.
   * NO NEW COLUMN, NO THIRD `households.state`.
   * ================================================================
   *
   * That one row edit already means everything "archived" has to mean, because
   * four mechanisms are keyed off it and were shipped before this method
   * existed:
   * - `householdQueryService.listPastForUser` reads exactly `removed`, so the
   *   household lands in the switcher's "Past households" section rather than
   *   vanishing (A10) — a parent who archived by mistake can still read it.
   * - `listForUser` is active-only, so it leaves his live list on the spot.
   * - Every write in this codebase is gated on an ACTIVE membership, so the
   *   household is read-only for him from that instant, with no per-table work.
   * - For a DRAFT, 094's `draft_has_no_author` check refuses every outstanding
   *   code the moment the author's membership stops being active — so
   *   archiving a draft also kills the links she shared, which is precisely
   *   what A6's auto-archive needs.
   *
   * A migration would buy a column that says what these four already say, and
   * 094 is applied to production and must stay frozen.
   *
   * Who may archive: a parent (owner included — unlike `leave`, which refuses
   * the owner to keep a household from being orphaned; here being orphaned is
   * the POINT), or the §2.2 draft author closing her own draft. A nanny or
   * helper in a live household is refused and must use `leave` — walking out
   * of a job is not the same act as closing a family, and `leave` carries the
   * clocked-in refusal and the pay end-date that this one has no business
   * doing.
   *
   * A LIVE household with another active NANNY in it is refused outright
   * (A4: the destructive option is HIDDEN when a carer is attached — and
   * hidden is not enforced). Removing her is a separate, deliberate act with
   * its own consequences; it must not happen as a side effect of a parent
   * tidying up. A draft is exempt: its only member IS the nanny, and she is
   * the one archiving.
   */
  async archive(userId: string, householdId: string): Promise<HouseholdMember> {
    // Throws HouseholdNotFoundError for both "no such household" and "not a
    // member" — a stranger learns nothing either way.
    const membership = await this.queries.getMembership(userId, householdId);
    const household = await this.householdRepo.findById(householdId);

    if (
      !PARENT_ROLES.has(membership.role) &&
      !isDraftAuthor(household, membership)
    ) {
      throw new NotAHouseholdParentError(householdId, membership.role);
    }

    if (household?.state === HOUSEHOLD_STATES.LIVE) {
      const others = await this.memberRepo.listActiveByHousehold(householdId);
      if (
        others.some(
          m => m.id !== membership.id && m.role === HOUSEHOLD_ROLES.NANNY
        )
      ) {
        throw new HouseholdHasCarerError(householdId);
      }
    }

    const removed = await this.memberRepo.removeMembership(membership.id);
    if (!removed) {
      // CAS matched nothing: already archived, or the other parent won the race.
      throw new MemberNotFoundError(membership.id);
    }
    return removed;
  }

  /**
   * Set which holidays this household observes. Owner/parent only —
   * D-12's owner note is "configurable by the parent"; from 3-O the nanny may
   * PROPOSE terms, and a proposal is not a write to this table.
   *
   * Keys the payload does not name are LEFT ALONE (an upsert, never a
   * delete-then-insert), so an older client that knows ten of eleven holidays
   * cannot silently switch off the eleventh. The response is the FULL
   * post-write calendar rather than the touched rows, because the terms screen
   * renders the whole group.
   *
   * Validity of a key depends on the household's country, which the wire
   * schema cannot see — a CA key is writable for a CA household and refused
   * for a US one. One unknown key refuses the whole request.
   */
  async setHolidays(
    userId: string,
    householdId: string,
    input: SetHouseholdHolidaysRequest
  ): Promise<HouseholdHoliday[]> {
    const membership = await this.queries.getMembership(userId, householdId);
    this.assertWriteRole(householdId, membership);

    const household = await this.householdRepo.findById(householdId);
    if (!household) {
      throw new HouseholdNotFoundError(householdId);
    }
    const unknown = input.holidays.find(
      entry => !isHolidayKeyForCountry(household.country, entry.holiday_key)
    );
    if (unknown) {
      throw new UnknownHolidayKeyError(householdId, unknown.holiday_key);
    }

    await this.holidays.upsertMany(householdId, input.holidays);
    return this.holidays.listForHousehold(householdId);
  }

  /**
   * Replace this household's authored custom days. Same parent gate as
   * `setHolidays`. An empty set is how the last custom day is deleted —
   * custom days are dates, not pack keys, and they are country-independent.
   */
  async setCustomHolidays(
    userId: string,
    householdId: string,
    input: SetHouseholdCustomHolidaysRequest
  ): Promise<HouseholdCustomHoliday[]> {
    const membership = await this.queries.getMembership(userId, householdId);
    this.assertWriteRole(householdId, membership);
    return this.customHolidays.replaceSet(householdId, input.custom_holidays);
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
   *
   * `country` is the other field that reads the current row: a change drops
   * keys the new pack does not contain, then seeds the new pack. Shared keys
   * keep their toggle (`seedCountryPack` ignores conflicts). Custom days are
   * dates and are not touched. The two reads share one `findById`.
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

    let current: Household | null = null;
    if (input.week_starts_on !== undefined || input.country !== undefined) {
      current = await this.householdRepo.findById(householdId);
    }

    if (input.week_starts_on !== undefined) {
      if (current && input.week_starts_on !== current.week_starts_on) {
        const hasTimesheets =
          await this.timesheets.existsForHousehold(householdId);
        if (hasTimesheets) {
          throw new WeekStartLockedError(householdId);
        }
      }
    }

    const updated = await this.householdRepo.update(householdId, input);

    if (
      input.country !== undefined &&
      current !== null &&
      input.country !== current.country
    ) {
      try {
        await this.holidays.deleteKeysNotIn(
          householdId,
          holidayKeysForCountry(input.country)
        );
        await this.holidays.seedCountryPack(householdId, input.country);
      } catch (error) {
        logger.error('Failed to resync holiday pack after country change', {
          householdId,
          country: input.country,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return updated;
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
   *
   * DRAFT HOUSEHOLD (F7, defence in depth). A draft's only member is the
   * nanny who authored it (D-36) — no parent membership exists to have
   * written this offer, so this is unreachable from either client today
   * (no client attaches an offer to a draft invite, and the offer UI is
   * parent-gated). Refused anyway, for the same reason the role check above
   * refuses rather than drops: a client bug should surface at the keyboard,
   * not silently evaporate.
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
    if (household?.state === HOUSEHOLD_STATES.DRAFT) {
      throw new PayOfferNotForDraftHouseholdError(householdId);
    }
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
        invite,
        inviteHousehold
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

    // §8/A4 — LAST of the checks, FIRST of the writes. A nanny or helper code
    // is untouched: a carer legitimately belongs to several families.
    if (PARENT_ROLES.has(invite.role)) {
      await this.resolveParentHouseholdConflict(
        userId,
        input.archive_household_id
      );
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

    await this.promoteOfferToProposal(
      invite,
      userId,
      now,
      membership.display_name_override ?? null
    );

    // A6, the other direction: she authored a draft to write her own terms,
    // then a family invited her the ordinary way instead and her code was
    // never redeemed. Same zombie draft, same fix.
    if (invite.role === HOUSEHOLD_ROLES.NANNY) {
      await this.archiveOwnDrafts(userId);
    }

    const roleLabel = this.roleLabel(invite.role);
    // Same push type either way — "someone has access again" is the same alert
    // to a parent who did not send the invite; only the wording differs.
    const rejoined = existingMembership !== null;
    const carriedPto = rejoined
      ? await this.carriedOverPtoSentence(invite.household_id, userId)
      : '';
    // NAME HER. This is the one push a parent has been waiting on since she
    // finished setting up, and "Someone joined your household" answers the
    // wrong question — she knows something happened, she wants to know who.
    // Falls back to the role when the profile has no name yet, which is the
    // ordinary case for a nanny whose first ever API call was this redeem.
    try {
      // Inside the swallow-everything block on purpose: a display name is
      // decoration on a push, and nothing decorative may fail a redeem. If the
      // lookup throws we fall back to the role and carry on.
      let who = `A ${roleLabel}`;
      try {
        const profile = await this.users.getProfileById(userId);
        who = profile?.name?.trim() || who;
      } catch {
        // keep the role fallback
      }
      notifyHouseholdParents(invite.household_id, {
        title: rejoined
          ? `${who} rejoined your household`
          : `${who} joined your household`,
        body: rejoined
          ? `Your invite was redeemed — a ${roleLabel} rejoined the household.${carriedPto}`
          : `Your invite was redeemed — a new ${roleLabel} joined the household.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          householdId: invite.household_id,
          role: 'parent',
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw
    }

    return membership;
  }

  /**
   * §8/A4's three outcomes for a parent-role code, in one place: proceed,
   * refuse, or close the old family first.
   *
   * ================================================================
   * ORDER: VALIDATE -> ARCHIVE -> CLAIM. DELIBERATE.
   * ================================================================
   *
   * Every reason the code could be refused — revoked, expired, already
   * accepted, already a member — has run by the time this is called, so a
   * parent never loses his household to a code that was never going to work.
   * The claim CAS runs immediately AFTER, which leaves exactly one losable
   * race: two people redeeming the same code in the same instant, where the
   * loser has already archived. That is accepted, and it is the cheaper half
   * of the trade — claim-first would archive AFTER the code is burned, so any
   * failure in the archive strands a parent in two households with a code he
   * cannot re-use.
   *
   * `archive_household_id` must name a household in the caller's OWN live
   * parent set; anything else falls through to the refusal, because "close
   * that one instead" is not an instruction a client gets to give about a
   * household it does not speak for. The `others` filter does both jobs at
   * once — an absent, wrong, or foreign id leaves the conflicting household in
   * the list and throws BEFORE anything is archived.
   */
  private async resolveParentHouseholdConflict(
    userId: string,
    archiveHouseholdId?: string
  ): Promise<void> {
    const live = await this.liveParentHouseholdIds(userId);
    const blocking = live.filter(id => id !== archiveHouseholdId)[0];
    if (blocking) {
      throw new ParentAlreadyHasHouseholdError(blocking);
    }
    if (archiveHouseholdId && live.includes(archiveHouseholdId)) {
      // Not best-effort: `archive` refuses a household with a carer still in
      // it (A4), and that refusal has to reach the parent as the refusal of
      // the whole redemption, not as a swallowed log line.
      await this.archive(userId, archiveHouseholdId);
    }
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
   * ONE PUSH, ON TWO OUTCOMES ONLY (F3). She is by construction inside the app
   * at this instant — she just typed the code — so nothing is owed to HER; the
   * `INVITE_REDEEMED` push to the parents is untouched below and still fires.
   * But `failed` and `skipped_stale` are outcomes the INVITING PARENT can act
   * on (retry, or write a new offer), so he is told — never on
   * `skipped_no_inviter` (nobody left to tell) or `skipped_open_round` (not
   * news; he is already mid-negotiation with her).
   *
   * EVERY OUTCOME IS RECORDED (F3, 106) on `household_invites.pay_offer_promotion`
   * — the only record of what happened, since this method never throws. Both
   * the outcome write and the push are wrapped so a failure in either costs a
   * log line, never the redemption.
   */
  private async promoteOfferToProposal(
    invite: HouseholdInvite,
    carerId: string,
    now: () => Date,
    carerDisplayNameOverride: string | null
  ): Promise<void> {
    const offer = invite.pay_offer;
    if (invite.role !== HOUSEHOLD_ROLES.NANNY || !offer) {
      return;
    }

    let proposedBy: string | null = null;
    // F5: resolved once, up front, so the SAME name lands in the proposal on
    // success and in the parent's push on failure/staleness — falls back to
    // the shared 'Carer' literal if resolution itself somehow throws, same
    // never-throws posture as everything else in this method.
    let carerDisplayName = UNNAMED_CARER_DISPLAY_NAME;
    try {
      proposedBy = invite.invited_by;
      if (!proposedBy) {
        logger.info('Pay offer not promoted — the inviting parent is gone', {
          inviteId: invite.id,
        });
        await this.recordPromotionOutcome(
          invite.id,
          PAY_OFFER_PROMOTION_OUTCOMES.SKIPPED_NO_INVITER
        );
        return;
      }

      carerDisplayName = await this.resolveCarerDisplayName(
        carerId,
        carerDisplayNameOverride
      );

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
        await this.recordPromotionOutcome(
          invite.id,
          PAY_OFFER_PROMOTION_OUTCOMES.SKIPPED_STALE
        );
        this.notifyPayOfferNotPromoted(invite, proposedBy, carerDisplayName);
        return;
      }

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
        // after her profile is gone.
        carer_display_name: carerDisplayName,
        // `status` is deliberately absent: 092 defaults it to 'proposed', and
        // `termsProposalCommandService.propose` omits it for the same reason.
      });
      await this.recordPromotionOutcome(
        invite.id,
        PAY_OFFER_PROMOTION_OUTCOMES.PROMOTED
      );
    } catch (error) {
      if (error instanceof OpenTermsProposalExistsError) {
        logger.info('Pay offer not promoted — a round is already open', {
          inviteId: invite.id,
          householdId: invite.household_id,
          carerId,
        });
        await this.recordPromotionOutcome(
          invite.id,
          PAY_OFFER_PROMOTION_OUTCOMES.SKIPPED_OPEN_ROUND
        );
        return;
      }
      logger.error('Pay offer promotion failed — the join stands', {
        inviteId: invite.id,
        householdId: invite.household_id,
        carerId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.recordPromotionOutcome(
        invite.id,
        PAY_OFFER_PROMOTION_OUTCOMES.FAILED
      );
      if (proposedBy) {
        this.notifyPayOfferNotPromoted(invite, proposedBy, carerDisplayName);
      }
    }
  }

  /**
   * F5 — same resolution order the other two carer-display-name resolvers use
   * (`payArrangementCommandService.resolveCarerDisplayName`,
   * `termsProposalCommandService.resolveCarerDisplayName`): the household's
   * OWN `display_name_override` (what this family calls her) wins over the
   * profile name, and a whitespace-only override counts as absent.
   */
  private async resolveCarerDisplayName(
    carerId: string,
    displayNameOverride: string | null
  ): Promise<string> {
    const override = displayNameOverride?.trim();
    if (override) {
      return override;
    }
    const profile = await this.users.getProfileById(carerId);
    return profile?.name ?? UNNAMED_CARER_DISPLAY_NAME;
  }

  /**
   * F3 — write `promoteOfferToProposal`'s verdict to the only place it is ever
   * recorded. Wrapped so a database failure here costs a log line, never the
   * redemption already committed above it.
   */
  private async recordPromotionOutcome(
    inviteId: string,
    outcome: PayOfferPromotionOutcome
  ): Promise<void> {
    try {
      await this.inviteRepo.updatePayOfferPromotion(inviteId, outcome);
    } catch (error) {
      logger.error('Failed to record pay-offer promotion outcome', {
        inviteId,
        outcome,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * F3 — tell the inviting parent his offer needs another look. Fire-and-
   * forget, same discipline as every other push in this service: a delivery
   * failure must never fail the write that triggered it.
   */
  private notifyPayOfferNotPromoted(
    invite: HouseholdInvite,
    inviterId: string,
    carerDisplayName: string
  ): void {
    try {
      notifyUser(inviterId, {
        title: 'Your pay offer needs another look',
        body: `Your pay offer for ${carerDisplayName} needs another look`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.PAY_OFFER_NOT_PROMOTED,
          householdId: invite.household_id,
        },
      });
    } catch {
      // notifyUser is fire-and-forget; swallow any unexpected throw.
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
    invite: HouseholdInvite,
    draftHousehold: Household
  ): Promise<HouseholdMember | null> {
    // §8/A4, server backstop. With no `target_household_id` 094 INSTANTIATES a
    // household — a second live family for a parent who already has one,
    // reached through the back door rather than through a co-parent code. The
    // mobile client already forces the absorb branch; this is what makes it
    // true rather than polite. An ABSORB is exempt by construction: it joins
    // her to the household he already has.
    if (!input.target_household_id) {
      await this.assertNoOtherLiveParentHousehold(userId);
    }

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
        // 094/096 instantiate a live household with members and children but
        // NOTHING in household_holidays, and they do not copy the draft's
        // country. Absence means not observed, so the new family would
        // silently observe zero holidays. Seed here, best-effort: a failure
        // logs and the redemption stands. Absorb into an existing household
        // is exempt — that family already has its calendar.
        if (!input.target_household_id) {
          try {
            await this.householdRepo.update(result.household_id, {
              country: draftHousehold.country,
            });
            await this.holidays.seedCountryPack(
              result.household_id,
              draftHousehold.country
            );
          } catch (error) {
            logger.error('Failed to seed holidays for instantiated household', {
              householdId: result.household_id,
              country: draftHousehold.country,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        // A6 — her draft has done its job: a family joined with her code and
        // she now belongs to a LIVE household. 094 leaves the draft standing
        // forever (see its header), and that zombie is what makes the shell
        // swap trap her later. Archived HERE rather than in 094 because 094 is
        // applied to production and stays frozen.
        await this.archiveDraftForAuthor(
          invite.household_id,
          invite.invited_by
        );
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
   * A6's auto-archive: retire the author's membership in a draft that has
   * served its purpose.
   *
   * ==================================================================
   * NEVER THROWS, AND THAT IS THE POINT.
   * ==================================================================
   *
   * By the time this runs a real family has already joined and, on the 094
   * path, the whole redemption has committed. The worst a failure can cost is
   * a stale draft in her switcher — today's status quo — and the manual
   * archive button fixes it in one tap. Undoing a redemption over it would be
   * absurd, so every error is logged and swallowed.
   *
   * Deliberately NOT routed through `archive()`: the rule checks there answer
   * "may this person close this household", and nobody is asking. The subject
   * is the draft's own author, the household is her own draft, and the answer
   * was decided when she shared the code.
   */
  private async archiveDraftForAuthor(
    householdId: string,
    authorId: string | null
  ): Promise<void> {
    if (!authorId) {
      return;
    }
    try {
      const membership = await this.memberRepo.findActiveMembership(
        householdId,
        authorId
      );
      if (membership) {
        await this.memberRepo.removeMembership(membership.id);
      }
    } catch (error) {
      logger.error('Draft auto-archive failed — the redemption stands', {
        householdId,
        authorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Every draft this user authored and still actively belongs to, archived.
   *
   * Two existing reads and no new repository method: `listActiveByUser` gives
   * the household ids, `findByIds` gives their state and authorship in one
   * query rather than one per household (GOLDEN-FIXES #28). `created_by` is
   * checked as well as `state`, so a second nanny who somehow sits in someone
   * else's draft never archives it out from under its author.
   *
   * A LIST rather than a single lookup because nothing stops a nanny drafting
   * terms twice; in practice it is zero or one. Same never-throws posture as
   * `archiveDraftForAuthor`.
   */
  private async archiveOwnDrafts(userId: string): Promise<void> {
    try {
      const memberships = await this.memberRepo.listActiveByUser(userId);
      const ids = memberships.map(m => m.household_id);
      if (ids.length === 0) {
        return;
      }
      const households = await this.householdRepo.findByIds(ids);
      for (const household of households) {
        if (
          household.state === HOUSEHOLD_STATES.DRAFT &&
          household.created_by === userId
        ) {
          await this.archiveDraftForAuthor(household.id, userId);
        }
      }
    } catch (error) {
      logger.error('Draft auto-archive sweep failed — the join stands', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
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
            role: 'parent',
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
          // `role: 'carer'` is what makes `notificationRouteMap.ts`'s carer
          // arm reachable at all. No `draftId` here on purpose: her draft
          // (`invite.household_id`) is archived a few lines above this call
          // (A6), so it is no longer a valid destination — `proposalId`
          // alone is the honest route.
          role: 'carer',
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

    // F8 — withdraw any open terms proposal she cannot answer from a
    // household she is about to be removed from. Same ordering discipline as
    // `endForCarer` immediately below, and for the same reason: a throw here
    // refuses the whole removal with nothing changed, rather than flipping
    // membership over a carer who still has an open round nobody withdrew.
    await this.proposals.withdrawOpenForCarer(householdId, target.user_id);

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

    // The pattern teardown, and it belongs HERE — after the money, before the
    // CAS — for the same reason `endForCarer` sits where it does. Membership
    // first would leave a removed carer with an `accepted` pattern if this
    // throws, and `schedulePatternRepository.listAccepted` (the read
    // `scheduleHorizonJob` runs over) has NO membership filter: the job would
    // keep materialising her shifts to the horizon and `reminderJob` would
    // keep pushing "you have a shift tomorrow" at someone who no longer works
    // here. This way a throw refuses the whole removal with nothing changed.
    //
    // BOTH ids go to the read. She may work for two families, and ending the
    // pattern she still works under is the one mistake here that would be
    // unrecoverable.
    //
    // Was the third inlined copy of this loop; it is now one method that
    // account deletion, household closure and `leave` all run, so the rules it
    // encodes cannot drift apart per caller again. It hands back the days it
    // emptied, which is what the uncovered-care recompute below needs.
    const vacatedDates =
      await this.schedulePatterns.endAcceptedPatternsForCarer(
        householdId,
        target.user_id,
        now()
      );

    const removed = await this.memberRepo.removeMembership(memberId);
    if (!removed) {
      // CAS matched nothing: already removed, or another parent won the race.
      throw new MemberNotFoundError(memberId);
    }

    // A SECOND write, after the CAS and only for the caller that won it —
    // stamping a reason onto a row somebody else removed would be a lie.
    // 110's column is what a reader who missed the push below can still be
    // told: `status = 'removed'` alone cannot tell "a parent removed me" from
    // "the family closed the household under me".
    //
    // 112 adds the other two facts the household's own departure card needs:
    // WHEN (`ended_at` — not `updated_at`, which the 009 trigger bumps on any
    // later write and would put a year-old departure back on screen) and WHO
    // (`ended_by`, read only to keep the parent who acted from being told
    // about their own action).
    //
    // ponytail: one extra UPDATE on a rare path. Fold it into
    // `removeMembership` as an optional argument when that repository is next
    // touched.
    await this.memberRepo.update(memberId, {
      ended_reason: MEMBERSHIP_ENDED_REASONS.REMOVED_BY_PARENT,
      ended_at: now().toISOString(),
      ended_by: callerId,
    });

    // The relationship cache holds a POSITIVE membership answer for an hour
    // (`makeOwnershipValidator`), so without this the person just removed can
    // keep passing id-scoped write gates long after the row says otherwise —
    // GOLDEN-FIXES records a removed parent approving a week through exactly
    // this window. Account deletion has always done it; the two membership
    // paths did not.
    invalidateResourceRelationshipCache(target.user_id);

    this.raiseUncoveredForVacatedDates(householdId, vacatedDates, callerId);

    // She is told NOTHING otherwise — no push, no inbox item, no card — and
    // finds out by watching her controls disappear. No figure and no promise
    // about pay: whether she is owed anything is the payroll record's answer,
    // and guessing either way is expensive. AFTER the flip, so a push can
    // never announce a removal that did not happen.
    notifyUser(target.user_id, {
      title: `You're no longer with ${householdRow.name ?? 'this family'}`,
      body: 'Your record of the hours you worked stays here.',
      data: {
        type: PUSH_NOTIFICATION_TYPES.MEMBERSHIP_ENDED,
        householdId,
        reason: MEMBERSHIP_ENDED_REASONS.REMOVED_BY_PARENT,
      },
    });

    // THE OTHER PARENTS, which this path told nobody until now: in a
    // two-parent household one of them could remove the nanny and the other
    // would find out when a shift went uncovered. `excludeUserId` is the
    // whole point — the parent who did it does not need to be told they did
    // it, and being told would read as somebody else's decision.
    //
    // Wrapped like the departure push in `leave`, and for the same reason:
    // the membership row is already flipped and must not be undone by a
    // notification failure.
    try {
      notifyHouseholdParents(
        householdId,
        {
          title: `${await this.memberDisplayName(target)} is no longer in your household`,
          body: this.departureBody(target.role),
          data: {
            type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
            householdId,
            role: 'parent',
          },
        },
        { excludeUserId: callerId }
      );
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected
      // throw — the membership row is already flipped.
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

    // Empty for a co-parent or helper, who hold no patterns — so the recompute
    // below is a no-op for them, which is correct: their leaving takes nobody
    // off the calendar.
    let vacatedDates: readonly string[] = [];

    if (membership.role === HOUSEHOLD_ROLES.NANNY) {
      // F8, same NANNY-only gate as `endForCarer` just below: a terms
      // proposal only ever names a carer (`terms_proposals.carer_id`), so a
      // co-parent or helper leaving has no open round to withdraw. Same
      // ordering discipline too — a throw here refuses the whole leave with
      // nothing changed.
      await this.proposals.withdrawOpenForCarer(householdId, callerId);

      const householdRow = await this.householdRepo.findById(householdId);
      if (!householdRow) {
        throw new MemberNotFoundError(membership.id);
      }
      await this.payArrangements.endForCarer(
        householdId,
        callerId,
        localDateOf(now(), householdRow.timezone)
      );

      // The teardown this path was missing entirely, and the reason it had to
      // be added before the leave button could be offered to anyone: patterns
      // are read by `scheduleHorizonJob` through `listAccepted`, which has NO
      // membership filter. A carer who left while still holding an `accepted`
      // pattern kept having shifts materialised to the horizon, kept getting
      // "you have a shift tomorrow", and kept appearing on the family's
      // calendar as cover that was never coming.
      //
      // NANNY-only for the same reason as the two writes above: a co-parent or
      // helper holds no pattern, because neither can be a shift's carer.
      //
      // Before the CAS, like everything else in this branch — a throw here
      // refuses the whole leave with nothing changed, rather than flipping a
      // membership and leaving live patterns behind it.
      vacatedDates = await this.schedulePatterns.endAcceptedPatternsForCarer(
        householdId,
        callerId,
        now()
      );
    }

    const removed = await this.memberRepo.removeMembership(membership.id);
    if (!removed) {
      // CAS matched nothing: a parent removed them between the read and here,
      // or a duplicate tap won first.
      throw new MemberNotFoundError(membership.id);
    }

    // Same three facts `removeMember` stamps, and for the same reasons —
    // except `ended_reason` is `left`, the third value 112 added. Without it a
    // self-departure is indistinguishable from a row written before 110, and
    // the family's card would have to announce a resignation as a removal.
    // `ended_by` is the leaver themselves, which is what keeps the card off
    // their own screen if they ever read the household again.
    await this.memberRepo.update(membership.id, {
      ended_reason: MEMBERSHIP_ENDED_REASONS.LEFT,
      ended_at: now().toISOString(),
      ended_by: callerId,
    });

    // See `removeMember` for why this cannot wait for the cache to expire.
    invalidateResourceRelationshipCache(callerId);

    this.raiseUncoveredForVacatedDates(householdId, vacatedDates, callerId);

    // Nobody in the household initiated this, so without a push the family
    // finds out when a shift goes uncovered.
    //
    // NAMED, per `docs/design/02-VOICE.md`'s first rule: "A nanny left the
    // household" tells a two-carer family the one thing they already knew and
    // withholds the one thing they need.
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
        title: `${await this.memberDisplayName(membership)} left your household`,
        body: this.departureBody(membership.role),
        data: {
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          householdId,
          role: 'parent',
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
  /**
   * How a member reads in a push ABOUT them, to somebody else:
   * `display_name_override` -> their profile name -> `A nanny`.
   *
   * NAME PEOPLE (`docs/design/02-VOICE.md`) — "A nanny left the household"
   * answers the wrong question. The parent knows a nanny left; they want to
   * know which one, and in a two-carer household the role alone is useless.
   *
   * Never throws. The profile read is the only part that can fail and it is
   * caught here, because a display name is decoration on a push and nothing
   * decorative may fail a membership write — the same rule `redeemInvite`
   * states and `userService`'s owner-handover push repeats: a lookup that
   * fails costs the reader a name, never the household the write.
   *
   * Safe to call AFTER the status flip: `display_name_override` lives on the
   * row that was soft-removed, not deleted, and the `user_profiles` row is
   * untouched by anything short of account deletion.
   */
  private async memberDisplayName(member: HouseholdMember): Promise<string> {
    const override = member.display_name_override?.trim();
    if (override) {
      return override;
    }
    try {
      const profile = await this.users.getProfileById(member.user_id);
      const name = profile?.name?.trim();
      if (name) {
        return name;
      }
    } catch {
      // fall through to the role label
    }
    return `A ${this.roleLabel(member.role)}`;
  }

  /**
   * What a departure MEANS to the family, in one line, keyed on what the
   * person actually did here. A carer's departure is a hole in the week; a
   * co-parent's or helper's is a loss of access and nothing else.
   *
   * Deliberately says nothing about money or about cover. The specific,
   * urgent alert — "Tuesday 8:00 AM is uncovered" — is uncovered-care
   * detection's to send, and it names the day this one cannot.
   */
  private departureBody(role: string): string {
    return role === HOUSEHOLD_ROLES.NANNY
      ? 'Nothing further is scheduled for them.'
      : 'They no longer have access to your household.';
  }

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

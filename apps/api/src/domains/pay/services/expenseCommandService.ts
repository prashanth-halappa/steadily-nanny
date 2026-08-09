/**
 * Expense command service (CQRS-lite: writes) — the ONLY authorization gate
 * for the `expenses` table. `044_expenses.sql`'s RLS is select-only by
 * design (`docs/11-MONEY.md` §8): a client-exercisable write policy would let
 * a nanny insert `status = 'approved'` with an arbitrary amount, self-
 * approving her own money. Every rule below is what makes that impossible.
 *
 * FOUR methods, four different gates:
 *
 * 1. `create` — CARER-gated. The caller must be an ACTIVE `nanny` member of
 *    THIS household (D12-class: `household_id` is a client-supplied
 *    context a write must be asserted against, docs/11-MONEY.md §9).
 *    `status` is always written as `'pending'`, `carer_id` as the CALLER
 *    (never client-supplied), and `carer_display_name` is snapshotted the
 *    same way `payArrangementCommandService.create` does. Currency must
 *    match the effective pay arrangement's currency on `local_date`
 *    (`payArrangementRepository.effectiveOn`) when an arrangement exists;
 *    a mismatch is a typed `ExpenseValidationError`. Non-mileage claims do
 *    NOT require an arrangement — the submitted `currency` stands on its own
 *    (`docs/11-MONEY.md` §9). Mileage claims and mileage approval still
 *    require one (`NO_PAY_ARRANGEMENT`), because the rate lives there. A
 *    mileage payload is NEVER read for `amount_minor` — the write
 *    is built field-by-field per `kind`, so a stray client field cannot
 *    reach the row even if it slipped past the wire schema's `.strict()`
 *    union.
 * 2. `update`/`withdraw` — OWNING-CARER-gated, `status = 'pending'` only, and
 *    the caller must STILL be an active `nanny` member (F-B3b-3: owning the
 *    row was never enough — a removed carer could edit `amount_minor` on a
 *    claim she left behind; see `loadOwnedPending`).
 *    Reviewed rows are immutable (migration 044's header): the guard is
 *    enforced TWICE — once here (so the right error fires) and once inside
 *    the repository's own WHERE clause (so a race that reviews the row
 *    between this read and that write cannot slip through either).
 * 3. `review` — PARENT-gated (single parent suffices, same as
 *    `payArrangementCommandService`, owner decision 1); a caller who may not
 *    review gets the SAME 404 as a caller naming an expense that does not
 *    exist, so no uuid can be probed for existence (Phase 3/4 review, MINOR
 *    9 — the collapse `loadOwnedPending` already applies). Approving a
 *    `mileage` row RE-ASSERTS the effective arrangement's currency (review
 *    SERIOUS 5) and then computes `amount_minor = round(miles x
 *    mileage_rate_per_mile_minor)` — half-up, integer arithmetic only, see
 *    `priceMileage` — and freezes it into the SAME update as the status
 *    flip. No mileage rate on the effective arrangement is a typed error,
 *    never a zero amount (`docs/11-MONEY.md` §4's no-arrangement-no-zero
 *    rule). Approving an `expense` row, and rejecting either kind, computes
 *    nothing. APPROVING anything into a week whose timesheet is already
 *    `approved` is refused with `ExpenseWeekLockedError` — see
 *    `assertWeekNotFrozen` for why blocking beats reopening, and
 *    `expenseRepository.reviewPending` for why that refusal ALSO travels into
 *    the write itself as a week lock (F-B4-1: the pre-check alone cannot see
 *    a timesheet approve that lands between it and the commit).
 *
 * @module domains/pay/services/expenseCommandService
 */
import {
  type CreateExpenseRequest,
  EXPENSE_KINDS,
  EXPENSE_STATUSES,
  type Expense,
  type ExpenseKind,
  type ReviewExpenseRequest,
  type UpdateExpenseRequest,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import {
  MAX_MONEY_MINOR,
  type PayArrangement,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { HOUSEHOLD_ROLES, HouseholdMemberRepository } from '../../household';
import {
  notifyHouseholdParents,
  notifyUser,
} from '../../notification/services/householdPush';
import { TimesheetRepository } from '../../timesheet/repositories/timesheetRepository';
import { weekStartOfLocalDate } from '../../timesheet/utils/weekStart';
import { UserService } from '../../user';
import {
  ExpenseAmountTooLargeError,
  ExpenseNotEditableError,
  ExpenseNotFoundError,
  ExpenseValidationError,
  ExpenseWeekLockedError,
} from '../errors/payErrors';
import {
  ExpenseRepository,
  type ExpenseWeekLock,
  type ReviewPatch,
} from '../repositories/expenseRepository';
import { PayArrangementRepository } from '../repositories/payArrangementRepository';

/** Roles allowed to review a claim — the household write roles, unchanged. */
const REVIEW_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/**
 * Fallback for `carer_display_name` when the member has no override and the
 * carer's profile has no `name` (both nullable). Deliberately the same
 * literal as `payArrangementCommandService`'s (and 033's backfill), so an
 * unnamed carer reads identically across every payroll record.
 */
const UNNAMED_CARER_DISPLAY_NAME = 'Carer';

/**
 * `miles` backs a `numeric(6,1)` column — always exactly one decimal place —
 * so `miles x 10` is always an integer. Scaling by this factor is what lets
 * the whole computation stay in integers, the same discipline
 * `earningsService.priceMinutes` uses for `minutes / 60`.
 */
const MILES_SCALE = 10;

/** The one timesheet status whose earnings are frozen (`docs/11-MONEY.md` §3). */
const APPROVED_TIMESHEET_STATUS = 'approved';

/**
 * Only the week lookup this service needs, declared as an interface rather
 * than the class for the same reason `WeekEarningsComputer` is: it keeps the
 * pay domain's dependency on the timesheet domain one function wide and lets
 * a caller's tests supply a stub. READ-ONLY, deliberately — this service
 * asks whether a week is frozen; it never reopens one (see
 * `assertWeekNotFrozen`).
 */
export interface ExpenseWeekTimesheetLookup {
  findByWeek: (
    householdId: string,
    carerId: string,
    weekStart: string
  ) => Promise<{ status: string } | null>;
}

/**
 * THE mileage-pricing rule: `round(miles x rateMinorPerMile)`, half-up
 * (toward +∞), computed WITHOUT ever holding a fractional value — mirroring
 * `earningsService.priceMinutes` exactly, with `MILES_SCALE` (10) standing in
 * for that function's `MINUTES_PER_HOUR` (60).
 *
 * `miles` is `numeric(6,1)`, so `Math.round(miles * MILES_SCALE)` recovers
 * the exact integer number of tenths-of-a-mile (the DB never stores more
 * precision than that, so this is not a lossy rounding step — it undoes
 * float noise from crossing the wire, the same role
 * `overtimeRateMinor`'s `Math.round(multiplier * 100)` plays for a
 * `numeric(3,2)`). `milesTenths * rateMinorPerMile` is then an exact integer
 * product of two integers, and
 *
 *   half-up(milesTenths x rate / MILES_SCALE)
 *     = floor(milesTenths x rate / MILES_SCALE + 1/2)
 *     = floor((milesTenths x rate x 2 + MILES_SCALE) / (MILES_SCALE x 2))
 *
 * is exact integer division with no binary-fraction step anywhere —
 * `0.1 + 0.2 !== 0.3` is precisely the class of error this exists to avoid
 * (`docs/11-MONEY.md` §1).
 *
 * PINNED BOUNDARY CASE: 1.1 miles at 45p/mile is exactly 49.5p —
 * `milesTenths = 11`, `11 x 45 = 495`, `floor((495*2 + 10) / 20) =
 * floor(1000/20) = 50`. Half-up rounds the exact half UP, to 50p, never 49p.
 */
export function priceMileage(miles: number, rateMinorPerMile: number): number {
  const milesTenths = Math.round(miles * MILES_SCALE);
  const exactNumerator = milesTenths * rateMinorPerMile;
  return Math.floor((exactNumerator * 2 + MILES_SCALE) / (MILES_SCALE * 2));
}

export class ExpenseCommandService {
  constructor(
    private readonly expenseRepo: ExpenseRepository = new ExpenseRepository(),
    private readonly arrangementRepo: PayArrangementRepository = new PayArrangementRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    // Only `getProfileById` is needed, so tests can inject a lightweight stub
    // instead of the full static class (same seam as
    // `payArrangementCommandService`).
    private readonly userService: Pick<
      typeof UserService,
      'getProfileById'
    > = UserService,
    private readonly timesheetRepo: ExpenseWeekTimesheetLookup = new TimesheetRepository()
  ) {}

  /** Gate 1 — see the module doc. Submit a new claim, always `pending`. */
  async create(
    callerId: string,
    householdId: string,
    request: CreateExpenseRequest
  ): Promise<Expense> {
    const membership = await this.assertActiveNanny(householdId, callerId);

    const effective = await this.arrangementRepo.effectiveOn(
      householdId,
      callerId,
      request.local_date
    );
    this.assertCurrencyMatches(
      request.kind,
      effective,
      request.currency,
      householdId,
      callerId
    );

    const carerDisplayName = await this.resolveCarerDisplayName(
      callerId,
      membership.display_name_override
    );

    const created = await this.expenseRepo.create({
      household_id: householdId,
      carer_id: callerId,
      local_date: request.local_date,
      kind: request.kind,
      description: request.description,
      amount_minor:
        request.kind === EXPENSE_KINDS.EXPENSE ? request.amount_minor : null,
      miles: request.kind === EXPENSE_KINDS.MILEAGE ? request.miles : null,
      currency: request.currency,
      status: EXPENSE_STATUSES.PENDING,
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      carer_display_name: carerDisplayName,
    });

    // Parents need to review a new claim before it becomes money owed.
    try {
      notifyHouseholdParents(created.household_id, {
        title: 'New expense claim',
        body:
          created.kind === EXPENSE_KINDS.MILEAGE
            ? 'Your nanny submitted a mileage claim.'
            : 'Your nanny submitted an expense.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.EXPENSE_SUBMITTED,
          householdId: created.household_id,
          weekStart: weekStartOfLocalDate(created.local_date),
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw
    }

    return created;
  }

  /** Gate 2 — the owning carer, `status = 'pending'` only. */
  async update(
    callerId: string,
    expenseId: string,
    request: UpdateExpenseRequest
  ): Promise<Expense> {
    const existing = await this.loadOwnedPending(callerId, expenseId);

    const effective = await this.arrangementRepo.effectiveOn(
      existing.household_id,
      callerId,
      request.local_date
    );
    this.assertCurrencyMatches(
      request.kind,
      effective,
      request.currency,
      existing.household_id,
      callerId
    );

    const updated = await this.expenseRepo.updateOwnedPending(
      expenseId,
      existing.household_id,
      callerId,
      {
        local_date: request.local_date,
        kind: request.kind,
        description: request.description,
        amount_minor:
          request.kind === EXPENSE_KINDS.EXPENSE ? request.amount_minor : null,
        miles: request.kind === EXPENSE_KINDS.MILEAGE ? request.miles : null,
        currency: request.currency,
      }
    );
    if (!updated) {
      // Lost the race: the row was reviewed between the read above and this
      // write. Same situation as the pre-check, just noticed a moment later.
      throw new ExpenseNotEditableError(expenseId, 'already_reviewed');
    }
    return updated;
  }

  /** Gate 2 (same as `update`) — hard-delete a still-pending claim. */
  async withdraw(callerId: string, expenseId: string): Promise<void> {
    const existing = await this.loadOwnedPending(callerId, expenseId);
    const deleted = await this.expenseRepo.deleteOwnedPending(
      expenseId,
      existing.household_id,
      callerId
    );
    if (!deleted) {
      throw new ExpenseNotEditableError(expenseId, 'already_reviewed');
    }
  }

  /** Gate 3 — parent-only. Approve or reject a pending claim. */
  async review(
    callerId: string,
    expenseId: string,
    request: ReviewExpenseRequest
  ): Promise<Expense> {
    const existing = await this.expenseRepo.findById(expenseId);
    if (!existing) {
      throw new ExpenseNotFoundError(expenseId, { reason: 'not_found' });
    }
    await this.assertReviewRole(callerId, existing.household_id, expenseId);
    if (existing.status !== EXPENSE_STATUSES.PENDING) {
      throw new ExpenseNotEditableError(expenseId, 'not_pending');
    }

    // The week lock this review's WRITE must carry (F-B4-1). Only an APPROVAL
    // moves money into a week, and only a row with a carer has a week at all.
    const weekLock: ExpenseWeekLock | null =
      request.status === EXPENSE_STATUSES.APPROVED && existing.carer_id
        ? {
            carerId: existing.carer_id,
            weekStart: weekStartOfLocalDate(existing.local_date),
          }
        : null;

    if (request.status === EXPENSE_STATUSES.APPROVED) {
      await this.assertWeekNotFrozen(existing);
    }

    const patch: ReviewPatch = {
      status: request.status,
      reviewed_by: callerId,
      reviewed_at: new Date().toISOString(),
      review_note: request.review_note ?? null,
    };

    // Only an APPROVED mileage row needs anything computed — rejecting, or
    // approving an ordinary expense row (whose amount was fixed at
    // submission), touches nothing but status/review metadata.
    if (
      request.status === EXPENSE_STATUSES.APPROVED &&
      existing.kind === EXPENSE_KINDS.MILEAGE
    ) {
      patch.amount_minor = await this.priceMileageApproval(existing);
    }

    const result = await this.expenseRepo.reviewPending(
      expenseId,
      existing.household_id,
      patch,
      weekLock
    );
    if (result.outcome === 'week_locked') {
      // The week froze between `assertWeekNotFrozen` above and this write —
      // the exact interleaving the pre-check alone cannot see (F-B4-1). Same
      // error the pre-check raises, so the client's handling is unchanged.
      throw new ExpenseWeekLockedError(
        expenseId,
        existing.household_id,
        result.weekStart,
        result.timesheetStatus
      );
    }
    if (result.outcome !== 'reviewed') {
      // Lost the race: another review landed between the read above and
      // this write.
      throw new ExpenseNotEditableError(expenseId, 'not_pending');
    }
    const reviewed = result.expense;

    // @see TIER0-PLAN.md:786 — carer learns the outcome of her claim here.
    if (reviewed.carer_id) {
      try {
        const expensePushData = {
          householdId: reviewed.household_id,
          weekStart: weekStartOfLocalDate(reviewed.local_date),
        };
        if (reviewed.status === EXPENSE_STATUSES.APPROVED) {
          notifyUser(reviewed.carer_id, {
            title: 'Expense approved',
            body:
              reviewed.kind === EXPENSE_KINDS.MILEAGE
                ? 'A parent approved your mileage claim.'
                : 'A parent approved your expense.',
            data: {
              type: PUSH_NOTIFICATION_TYPES.EXPENSE_APPROVED,
              ...expensePushData,
            },
          });
        } else if (reviewed.status === EXPENSE_STATUSES.REJECTED) {
          notifyUser(reviewed.carer_id, {
            title: 'Expense rejected',
            body:
              reviewed.kind === EXPENSE_KINDS.MILEAGE
                ? 'A parent rejected your mileage claim.'
                : 'A parent rejected your expense.',
            data: {
              type: PUSH_NOTIFICATION_TYPES.EXPENSE_REJECTED,
              ...expensePushData,
            },
          });
        }
      } catch {
        // notifyUser is sync fire-and-forget; swallow any unexpected throw
      }
    }

    return reviewed;
  }

  /**
   * Resolve and freeze the mileage amount for an approval — the arrangement
   * effective on the CLAIM's `local_date` (not today), same rule as every
   * other frozen figure in this domain. No arrangement, or an arrangement
   * with no mileage rate set, is refused rather than priced at zero
   * (`docs/11-MONEY.md` §4).
   */
  private async priceMileageApproval(existing: Expense): Promise<number> {
    const arrangement = existing.carer_id
      ? await this.arrangementRepo.effectiveOn(
          existing.household_id,
          existing.carer_id,
          existing.local_date
        )
      : null;

    // RE-ASSERT THE CURRENCY BEFORE PRICING (Phase 3/4 review, SERIOUS 5).
    // `create` checked the claim's currency against the effective
    // arrangement, but the arrangement effective on `local_date` can CHANGE
    // between submission and review without any date moving: a same-day
    // correcting row supersedes the one it fixes via the `created_at desc`
    // tie-break (`docs/11-MONEY.md` §2), and that is the documented,
    // only mechanism for fixing a mistyped arrangement. If the correction
    // changed the currency, pricing here would derive an amount from a USD
    // rate and freeze it onto a row that says GBP — a wrong number wearing
    // the right label, which is the one failure mode §1 exists to prevent.
    // Rejecting is unaffected: it prices nothing, so it never gets here.
    this.assertCurrencyMatches(
      EXPENSE_KINDS.MILEAGE,
      arrangement,
      existing.currency,
      existing.household_id,
      existing.carer_id ?? ''
    );

    const rateMinor = arrangement?.mileage_rate_per_mile_minor;
    if (!arrangement || rateMinor === null || rateMinor === undefined) {
      throw new ExpenseValidationError('NO_MILEAGE_RATE', {
        expenseId: existing.id,
        householdId: existing.household_id,
        carerId: existing.carer_id,
        localDate: existing.local_date,
      });
    }
    // `miles` is NOT NULL for a mileage row (044's `expenses_mileage_has_miles`
    // check) — the `?? 0` is unreachable defensive coverage, never a real value.
    const amountMinor = priceMileage(existing.miles ?? 0, rateMinor);

    // INDIVIDUALLY-CAPPED INPUTS MULTIPLY INTO UNBOUNDED COMPUTED MONEY — the
    // DB CHECK is the backstop, this guard is the clean failure.
    // `miles` and `mileage_rate_per_mile_minor` are each bounded on their own
    // (041/063, and the Zod schemas), and neither bound says anything about
    // their product: 10 miles at the schema-legal maximum rate computes
    // 999_999_990, ten times over migration 063's
    // `expenses_amount_minor_upper`. Without this the constraint still catches
    // it, but as a raw 23514 surfacing as a generic DatabaseError in the
    // middle of an approval — the parent gets a 500 for a claim that is not
    // her fault and not diagnosable. Refusing here makes it a readable 400
    // before any write is attempted.
    //
    // NOT CLAMPED, deliberately (`docs/11-MONEY.md` §1): a reimbursement
    // trimmed to fit is a wrong number that would actually be paid.
    if (amountMinor > MAX_MONEY_MINOR) {
      throw new ExpenseAmountTooLargeError(
        existing.id,
        amountMinor,
        MAX_MONEY_MINOR
      );
    }
    return amountMinor;
  }

  /**
   * Fetch an expense, enforcing "the owning carer, still pending" in ONE
   * place shared by `update` and `withdraw`. "Doesn't exist" and "belongs to
   * another carer" collapse into the SAME `ExpenseNotFoundError` — existence
   * must never leak (house convention, `PayArrangementNotFoundError`).
   * "Exists, is hers, but already reviewed" is a DIFFERENT error
   * (`ExpenseNotEditableError`) because that is not an existence leak — she
   * already knows her own claim was reviewed.
   *
   * OWNING THE ROW IS NOT ENOUGH — SHE MUST STILL BE AN ACTIVE NANNY HERE
   * (audit finding F-B3b-3). This used to check `carer_id` and status only,
   * so a carer whose membership had been REMOVED could still edit
   * `amount_minor` on a claim she left behind. `create` has always asserted
   * active-nanny membership (`assertActiveNanny`, gate 1); this is the same
   * assertion, on the same table, made consistent. It runs BEFORE the status
   * check and collapses into the SAME 404 as "not yours", so a removed member
   * learns neither that the row exists nor what state it is in.
   */
  private async loadOwnedPending(
    callerId: string,
    expenseId: string
  ): Promise<Expense> {
    const existing = await this.expenseRepo.findById(expenseId);
    if (!existing || existing.carer_id !== callerId) {
      throw new ExpenseNotFoundError(expenseId, {
        reason: 'not_found_or_not_yours',
      });
    }
    const membership = await this.memberRepo.findActiveMembership(
      existing.household_id,
      callerId
    );
    if (!membership || membership.role !== HOUSEHOLD_ROLES.NANNY) {
      throw new ExpenseNotFoundError(expenseId, {
        reason: 'not_found_or_not_yours',
      });
    }
    if (existing.status !== EXPENSE_STATUSES.PENDING) {
      throw new ExpenseNotEditableError(expenseId, 'already_reviewed');
    }
    return existing;
  }

  /**
   * Gate 1's D12-class assertion: the caller must be an ACTIVE `nanny`
   * member of THIS household before her write is accepted. Returns the
   * membership row so the caller can read `display_name_override` off it
   * without a second lookup (same shape as
   * `payArrangementCommandService.assertActiveNanny`).
   */
  private async assertActiveNanny(
    householdId: string,
    callerId: string
  ): Promise<{ role: string; display_name_override: string | null }> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      callerId
    );
    if (!membership || membership.role !== HOUSEHOLD_ROLES.NANNY) {
      throw new ExpenseNotFoundError(householdId, {
        reason: 'caller_not_an_active_nanny',
      });
    }
    return membership;
  }

  /**
   * Gate 3's role check — a single parent/owner suffices (owner decision 1).
   *
   * REFUSES WITH THE SAME 404 AS "no such expense" (Phase 3/4 review, MINOR
   * 9). This used to raise `NotAHouseholdParentError` (403), which told a
   * caller holding a random uuid that the row EXISTS and merely belongs to
   * someone else's household — precisely the enumeration the house collapse
   * rule closes, and which `loadOwnedPending` two methods up already
   * follows. The discriminating detail stays in `metadata.reason`.
   */
  private async assertReviewRole(
    callerId: string,
    householdId: string,
    expenseId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      callerId
    );
    if (!membership || !REVIEW_ROLES.has(membership.role)) {
      throw new ExpenseNotFoundError(expenseId, {
        reason: 'caller_cannot_review_this_expense',
        householdId,
      });
    }
  }

  /**
   * Refuse to APPROVE a claim into a week whose timesheet is already
   * `approved` (Phase 3/4 review, SERIOUS 6).
   *
   * An approved week's earnings — reimbursement section included — are
   * frozen at approval and NEVER recomputed (`docs/11-MONEY.md` §3). Approve
   * an expense after that and the money exists on the row while appearing on
   * no statement anyone reads: real money owed, silently stranded.
   *
   * REOPENING THE WEEK WAS THE ALTERNATIVE, AND IS REFUSED. The reopen path
   * exists (§3, the D1 rule) but it is triggered by NEW HOURS — a fact about
   * work that happened and must be recorded whatever it costs the parent's
   * sign-off. A reimbursement is not that: it is not wages at all (§6), it
   * never touches gross, and letting one silently un-approve a payroll week
   * both parties agreed would give a non-wage item authority over the wage
   * record. So the parent is told, in the moment, instead of a signed-off
   * week quietly reverting under her.
   *
   * REJECTING is deliberately still allowed — it moves no money, so the
   * parent always has an action and the claim never becomes un-actionable.
   *
   * A carer-less row (`carer_id` null, 033's account-deletion discipline)
   * skips the check: her timesheets keyed by that id are equally carer-less,
   * there is no week to strand money in, and the review is bookkeeping.
   */
  private async assertWeekNotFrozen(existing: Expense): Promise<void> {
    if (!existing.carer_id) {
      return;
    }
    // `local_date` was resolved in the household's timezone when the claim
    // was written, so its week is pure calendar arithmetic — no second
    // timezone conversion (which is how a Sunday claim lands in the wrong
    // week).
    const weekStart = weekStartOfLocalDate(existing.local_date);
    const timesheet = await this.timesheetRepo.findByWeek(
      existing.household_id,
      existing.carer_id,
      weekStart
    );
    if (timesheet?.status === APPROVED_TIMESHEET_STATUS) {
      throw new ExpenseWeekLockedError(
        existing.id,
        existing.household_id,
        weekStart,
        timesheet.status
      );
    }
  }

  /**
   * When an effective pay arrangement exists, the claim's currency must
   * match its currency on `local_date`. Mileage claims (and mileage approval)
   * also require an arrangement — the mileage rate lives there, so nothing can
   * price or validate the claim without one (`NO_PAY_ARRANGEMENT`). Non-mileage
   * reimbursements do not require an arrangement; the submitted `currency`
   * stands on its own (`docs/11-MONEY.md` §9).
   */
  private assertCurrencyMatches(
    kind: ExpenseKind,
    arrangement: PayArrangement | null,
    currency: string,
    householdId: string,
    carerId: string
  ): void {
    if (!arrangement) {
      if (kind === EXPENSE_KINDS.MILEAGE) {
        throw new ExpenseValidationError('NO_PAY_ARRANGEMENT', {
          householdId,
          carerId,
        });
      }
      return;
    }
    if (arrangement.currency !== currency) {
      throw new ExpenseValidationError('CURRENCY_MISMATCH', {
        householdId,
        carerId,
        expectedCurrency: arrangement.currency,
        submittedCurrency: currency,
      });
    }
  }

  /**
   * Snapshot the carer's display name AT SUBMISSION TIME (033 discipline,
   * migration 044's header) — resolution order matches
   * `payArrangementCommandService`'s identical method: the household's own
   * `display_name_override` wins over the profile name, and a
   * whitespace-only override counts as absent.
   */
  private async resolveCarerDisplayName(
    carerId: string,
    displayNameOverride: string | null
  ): Promise<string> {
    const override = displayNameOverride?.trim();
    if (override) {
      return override;
    }
    const profile = await this.userService.getProfileById(carerId);
    return profile?.name ?? UNNAMED_CARER_DISPLAY_NAME;
  }
}

// Singleton for controllers/routes that don't need DI.
export const expenseCommandService = new ExpenseCommandService();

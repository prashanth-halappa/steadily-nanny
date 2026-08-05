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
 *    (`payArrangementRepository.effectiveOn`) — no arrangement, or a
 *    mismatched one, is a typed `ExpenseValidationError`, never a silent
 *    accept. A mileage payload is NEVER read for `amount_minor` — the write
 *    is built field-by-field per `kind`, so a stray client field cannot
 *    reach the row even if it slipped past the wire schema's `.strict()`
 *    union.
 * 2. `update`/`withdraw` — OWNING-CARER-gated, `status = 'pending'` only.
 *    Reviewed rows are immutable (migration 044's header): the guard is
 *    enforced TWICE — once here (so the right error fires) and once inside
 *    the repository's own WHERE clause (so a race that reviews the row
 *    between this read and that write cannot slip through either).
 * 3. `review` — PARENT-gated (single parent suffices, same as
 *    `payArrangementCommandService`, owner decision 1). Approving a
 *    `mileage` row computes `amount_minor = round(miles x
 *    mileage_rate_per_mile_minor)` — half-up, integer arithmetic only, see
 *    `priceMileage` — and freezes it into the SAME update as the status
 *    flip. No mileage rate on the effective arrangement is a typed error,
 *    never a zero amount (`docs/11-MONEY.md` §4's no-arrangement-no-zero
 *    rule). Approving an `expense` row, and rejecting either kind, computes
 *    nothing.
 *
 * @module domains/pay/services/expenseCommandService
 */
import {
  type CreateExpenseRequest,
  EXPENSE_KINDS,
  EXPENSE_STATUSES,
  type Expense,
  type ReviewExpenseRequest,
  type UpdateExpenseRequest,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  NotAHouseholdParentError,
} from '../../household';
import { UserService } from '../../user';
import {
  ExpenseNotEditableError,
  ExpenseNotFoundError,
  ExpenseValidationError,
} from '../errors/payErrors';
import {
  ExpenseRepository,
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
    > = UserService
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
    await this.assertReviewRole(callerId, existing.household_id);
    if (existing.status !== EXPENSE_STATUSES.PENDING) {
      throw new ExpenseNotEditableError(expenseId, 'not_pending');
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

    const reviewed = await this.expenseRepo.reviewPending(
      expenseId,
      existing.household_id,
      patch
    );
    if (!reviewed) {
      // Lost the race: another review landed between the read above and
      // this write.
      throw new ExpenseNotEditableError(expenseId, 'not_pending');
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
    return priceMileage(existing.miles ?? 0, rateMinor);
  }

  /**
   * Fetch an expense, enforcing "the owning carer, still pending" in ONE
   * place shared by `update` and `withdraw`. "Doesn't exist" and "belongs to
   * another carer" collapse into the SAME `ExpenseNotFoundError` — existence
   * must never leak (house convention, `PayArrangementNotFoundError`).
   * "Exists, is hers, but already reviewed" is a DIFFERENT error
   * (`ExpenseNotEditableError`) because that is not an existence leak — she
   * already knows her own claim was reviewed.
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

  /** Gate 3's role check — a single parent/owner suffices (owner decision 1). */
  private async assertReviewRole(
    callerId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      callerId
    );
    if (!membership || !REVIEW_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(
        householdId,
        membership?.role ?? 'none'
      );
    }
  }

  /**
   * The claim's currency must match the carer's effective pay-arrangement
   * currency on `local_date` — no arrangement to compare against is just as
   * invalid as a mismatched one; both are refused rather than silently
   * accepted (`docs/11-MONEY.md` §9).
   */
  private assertCurrencyMatches(
    arrangement: PayArrangement | null,
    currency: string,
    householdId: string,
    carerId: string
  ): void {
    if (!arrangement) {
      throw new ExpenseValidationError('NO_PAY_ARRANGEMENT', {
        householdId,
        carerId,
      });
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

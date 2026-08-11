/**
 * Payment command service (CQRS-lite: writes) — the settlement half of the
 * pay loop. 042 freezes what a week is WORTH at approval; this records that
 * it was PAID (migration 067, `docs/11-MONEY.md` §1/§3/§8/§9).
 *
 * ONE method, four gates, in this order — and the order decides which error
 * a caller is allowed to see:
 *
 * 1. **The week must exist and be the caller's.** `timesheet_id` arrives from
 *    the URL: a client-supplied foreign id on a write, the exact shape of
 *    defects D12/D14. Repositories run as the service role and 067 has no
 *    insert policy at all, so THIS is the only gate. "No such week" and "not
 *    your week" collapse into one `PaymentNotFoundError`.
 * 2. **Parents only.** The same mechanism `timesheetCommandService.approve`
 *    uses — `findActiveMembership` plus an owner/parent role set — because a
 *    payment is the counterpart of the approval and answers to the same
 *    people. The nanny cannot record that she was paid, and a helper cannot
 *    touch money at all. Refusal is the 403 `NotAHouseholdParentError`,
 *    matching `payArrangementCommandService`.
 * 3. **The week must be APPROVED with a frozen gross.** An unapproved week's
 *    figure is still "Estimated" and recomputes on every read (§3), so there
 *    is nothing to bound a payment against; a NULL snapshot (a pre-042 week,
 *    or an unpriceable one) has no ceiling and no currency.
 * 4. **`sum(existing payments) + amount <= gross_minor`.** A cross-row SUM
 *    cannot be a row CHECK (067's header), so it is enforced INSIDE THE WRITE
 *    by `record_timesheet_payment` (migration 077) rather than here. Over-
 *    payment is REFUSED, never clamped (§1) — a trimmed payment is a record
 *    of money that did not move — and the refusal carries the figures the
 *    lock actually saw.
 *
 * NOTHING FROM THE BODY DESCRIBES THE WEEK. `household_id`, `carer_id` and
 * `currency` are copied off the timesheet and `recorded_by` off the
 * authenticated caller, so a payment can never be filed against another
 * household, credited to another carer, or recorded in a currency the week
 * was not priced in — which is why `CreatePaymentSchema` carries no currency
 * field to begin with.
 *
 * `payments` is APPEND-ONLY: there is no update and no delete here or
 * anywhere, and a mistake is prevented at write time rather than corrected by
 * editing history (067's header, the same discipline as 041/043).
 *
 * THE READ-THEN-WRITE RACE IS CLOSED (migration 077). Gate 4 used to be a
 * sum here and an insert there, so two parents tapping "Record payment" in
 * the same instant each saw `sum = 0` and both committed, settling the week at
 * twice its gross — with no edit path to take the second row back. The sum,
 * the refusal and the insert are now one `record_timesheet_payment` call
 * behind a `FOR UPDATE` lock on the week's timesheet row, which serialises
 * against concurrent payments AND against an in-flight approve or reopen. The
 * window is unreachable from a unit test (Supabase is mocked everywhere), so
 * the SQL's half of the contract is pinned as source by
 * `tests/unit/migration077PaymentAtomicInsert.test.ts`.
 *
 * Gate 3 SURVIVES the move and is not redundant: it produces the correct 409
 * before any write, and keeps the approved-and-priced judgement in one place.
 * What it cannot do is stay true — a reopen can commit between it and the
 * lock — which is why 077 re-checks under the lock and answers `not_payable`,
 * and why that outcome maps back onto the same 409 here.
 *
 * @module domains/pay/services/paymentCommandService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  CreatePaymentInput,
  Payment,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  NotAHouseholdParentError,
} from '../../household';
import { notifyUser } from '../../notification/services/householdPush';
import type { PushPayload } from '../../notification/types';
// Concrete cross-domain import, never the timesheet barrel: this domain's
// `weekEarningsService` is imported BY the timesheet domain, so barrel-to-
// barrel imports between the two would form a cycle (see `domains/pay`'s
// barrel note). The repository, not `timesheetQueryService`, for the same
// reason — that service imports `weekEarningsService` from here.
import {
  TimesheetRepository,
  type TimesheetRow,
} from '../../timesheet/repositories/timesheetRepository';
import {
  PaymentExceedsGrossError,
  PaymentNotFoundError,
  PaymentWeekNotApprovedError,
} from '../errors/payErrors';
import { PaymentRepository } from '../repositories/paymentRepository';

/** Injectable push seam — defaults to the fire-and-forget household helper. */
export interface PaymentPushNotifier {
  notifyUser: (userId: string, payload: PushPayload) => void;
}

/**
 * Roles allowed to record a settlement — the household write roles, the same
 * set `timesheetCommandService`'s `WRITE_ROLES` gates approve/query/reopen
 * with. Paying for a week and signing one off are the same authority.
 */
const PAYMENT_WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/** A week that passed gate 3: approved, priced, and safe to stamp from. */
interface PayableWeek {
  timesheet: TimesheetRow;
  grossMinor: number;
  currency: string;
}

export class PaymentCommandService {
  constructor(
    private readonly paymentRepo: PaymentRepository = new PaymentRepository(),
    private readonly timesheetRepo: TimesheetRepository = new TimesheetRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly push: PaymentPushNotifier = { notifyUser }
  ) {}

  /** Record one real-world payment against an approved week. Returns the row. */
  async create(
    callerId: string,
    timesheetId: string,
    input: CreatePaymentInput
  ): Promise<Payment> {
    const timesheet = await this.assertPayableWeekIsCallers(
      callerId,
      timesheetId
    );
    this.assertApprovedAndPriced(timesheet);

    // Gate 4 and the insert, in one locked statement. Only the settlement's
    // own fields are sent: household, carer and currency are stamped inside
    // the function from the row it locks, so they cannot drift from — or be
    // made to disagree with — the week being paid.
    const outcome = await this.paymentRepo.recordForTimesheet(timesheet.id, {
      amount_minor: input.amount_minor,
      paid_at: input.paid_at,
      // Written explicitly rather than omitted: the column is nullable and
      // "the parent said nothing about how" is a fact worth stating.
      method_note: input.method_note ?? null,
      recorded_by: callerId,
    });

    if (outcome.outcome === 'exceeds_gross') {
      throw new PaymentExceedsGrossError(
        timesheetId,
        input.amount_minor,
        outcome.alreadyPaidMinor,
        outcome.grossMinor
      );
    }
    // Gate 3 passed and then stopped being true — a reopen landed between the
    // unlocked read and the lock. Same 409 the pre-check would have raised.
    if (outcome.outcome === 'not_payable') {
      throw new PaymentWeekNotApprovedError(
        timesheet.id,
        'week_changed_under_lock',
        { status: outcome.status }
      );
    }

    this.notifyCarerOfPayment(timesheet);
    return outcome.payment;
  }

  /** Gates 1 and 2 — see the module doc. Returns the week's row. */
  private async assertPayableWeekIsCallers(
    callerId: string,
    timesheetId: string
  ): Promise<TimesheetRow> {
    const timesheet = await this.timesheetRepo.findById(timesheetId);
    if (!timesheet) {
      throw new PaymentNotFoundError(timesheetId, {
        reason: 'timesheet_not_found',
      });
    }
    const membership = await this.memberRepo.findActiveMembership(
      timesheet.household_id,
      callerId
    );
    // A non-member gets the 404, not the 403: telling a stranger "you are not
    // a parent OF THIS HOUSEHOLD" confirms the week is real.
    if (!membership) {
      throw new PaymentNotFoundError(timesheetId, {
        reason: 'not_a_household_member',
      });
    }
    if (!PAYMENT_WRITE_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(
        timesheet.household_id,
        membership.role
      );
    }
    return timesheet;
  }

  /**
   * Gate 3 — see the module doc. Narrows the two nullable snapshot columns to
   * non-null in the type system as well as at runtime, so the stamped
   * currency below cannot be `null` by construction rather than by comment.
   */
  private assertApprovedAndPriced(timesheet: TimesheetRow): PayableWeek {
    if (timesheet.status !== 'approved') {
      throw new PaymentWeekNotApprovedError(timesheet.id, 'week_not_approved', {
        status: timesheet.status,
      });
    }
    if (timesheet.gross_minor === null || timesheet.currency === null) {
      throw new PaymentWeekNotApprovedError(timesheet.id, 'no_frozen_gross');
    }
    return {
      timesheet,
      grossMinor: timesheet.gross_minor,
      currency: timesheet.currency,
    };
  }

  /**
   * Fire-and-forget push to the carer who was just paid — never a household
   * fan-out: the parent recording it already knows, and a settlement is her
   * news. `notifyUser` (`householdPush.ts`) swallows delivery errors
   * internally; the try/catch is belt-and-braces against an unexpected
   * SYNCHRONOUS throw, matching `payArrangementCommandService`'s identical
   * guard around the same call.
   *
   * The `data` keys are a contract with the mobile route map, whose
   * `hoursHref` reads `householdId`/`weekStart`/`timesheetId` — renaming one
   * breaks the deep link, not just the payload.
   *
   * A carer-less week (033: she deleted her account) has nobody to notify.
   */
  private notifyCarerOfPayment(timesheet: TimesheetRow): void {
    if (!timesheet.carer_id) {
      return;
    }
    try {
      this.push.notifyUser(timesheet.carer_id, {
        title: 'Payment recorded',
        body: 'A parent recorded a payment for one of your approved weeks.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.PAYMENT_RECORDED,
          householdId: timesheet.household_id,
          weekStart: timesheet.week_start,
          timesheetId: timesheet.id,
        },
      });
    } catch {
      // notifyUser is sync fire-and-forget; swallow any unexpected throw.
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const paymentCommandService = new PaymentCommandService();

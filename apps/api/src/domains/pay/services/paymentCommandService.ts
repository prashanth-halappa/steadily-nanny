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
  CreatePaymentCorrectionInput,
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
  PaymentCorrectionExceedsOriginalError,
  PaymentExceedsGrossError,
  PaymentNotCorrectableError,
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

  /**
   * Record a CORRECTION against one payment (D-20, gap P3, migration 085,
   * attention spec §4.1). Returns the negative row.
   *
   * WHY THIS EXISTS. `PaymentDetailSheet` has told parents in production that
   * "payments can't be edited or removed; a correction is recorded as another
   * payment" — while 067's `amount_minor >= 1` made that other payment
   * impossible to write. David records one Zelle transfer twice and the ledger
   * says he paid the week twice, with no way back. This is the way back, and
   * it is an APPEND, not an edit: the original row keeps its full amount
   * forever. A ledger that quietly restates history is worse than one that
   * cannot be corrected at all.
   *
   * CORRECTING IS THE PAYER'S ACT, so this reuses `PAYMENT_WRITE_ROLES` and
   * gates 1 and 2 UNCHANGED — the same authority that records a payment
   * un-records one. A nanny who thinks a payment is wrong says so on the week
   * thread (3-T1's "This doesn't look right" on `PaymentDetailSheet`); that
   * entry point is hers and this one is not, and neither should grow into the
   * other.
   *
   * GATE 3 IS DELIBERATELY ABSENT. `create` requires an APPROVED, priced week
   * because a payment is bounded by the frozen gross. A correction is bounded
   * by the payment it reverses, so it needs no gross and no currency of its
   * own — which is what lets it work on a REOPENED week, as P16 and spec §4.1
   * both require ("a correction on a reopened week is still recordable, and
   * still shows"). 085 stamps the row from the ORIGINAL PAYMENT for exactly
   * this reason: a reopened week's `currency` is NULL.
   *
   * THE SIGN FLIP LIVES HERE AND NOWHERE ELSE. The wire carries a POSITIVE
   * magnitude — the sheet's field is "Amount to reverse", prefilled with the
   * original figure — and this is the one line that negates it. Asking a human
   * to type a minus sign to un-record a payment is how a correction ends up
   * adding money to a week.
   *
   * Gate 4's analogue (`|reversal| <= what is left of the original`) is inside
   * 085's function behind the same `FOR UPDATE` anchor `create` uses, for the
   * same P5 reason: two parents reversing one payment in the same instant each
   * read "nothing reversed yet". REFUSED, never clamped, with the figures the
   * lock saw.
   */
  async correct(
    callerId: string,
    timesheetId: string,
    paymentId: string,
    input: CreatePaymentCorrectionInput
  ): Promise<Payment> {
    const timesheet = await this.assertPayableWeekIsCallers(
      callerId,
      timesheetId
    );

    const outcome = await this.paymentRepo.recordCorrection(
      timesheet.id,
      paymentId,
      {
        // The one negation in the stack — see the doc above.
        amount_minor: -input.amount_minor,
        paid_at: input.paid_at,
        reason: input.reason,
        recorded_by: callerId,
      }
    );

    if (outcome.outcome === 'exceeds_original') {
      throw new PaymentCorrectionExceedsOriginalError(
        paymentId,
        input.amount_minor,
        outcome.originalAmountMinor,
        outcome.remainingMinor
      );
    }
    if (outcome.outcome === 'not_correctable') {
      throw new PaymentNotCorrectableError(paymentId, outcome.reason, {
        timesheetId,
      });
    }

    this.notifyCarerOfCorrection(timesheet);
    return outcome.correction;
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

  /**
   * The carer's news when a payment she was told about is taken back off the
   * record (§1.3 N5). Its OWN type, never a second `payment_recorded`: "money
   * was recorded for you" and "money that was recorded for you has been
   * reversed" are opposite facts, and sending the first for the second is
   * precisely how a nanny stops trusting the ledger.
   *
   * A8 holds — NO FIGURE IN THE BODY. She opens the week and sees both rows,
   * which is the only place the pair reads correctly; a number on a lock
   * screen with no original beside it is a number she cannot check.
   *
   * Same data keys as `notifyCarerOfPayment`: they are a contract with the
   * mobile route map's `hoursHref`, not a payload convention.
   */
  private notifyCarerOfCorrection(timesheet: TimesheetRow): void {
    if (!timesheet.carer_id) {
      return;
    }
    try {
      this.push.notifyUser(timesheet.carer_id, {
        title: 'Payment corrected',
        body: 'A parent recorded a correction to a payment on one of your weeks.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.PAYMENT_CORRECTED,
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

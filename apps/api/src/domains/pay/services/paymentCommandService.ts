/**
 * Payment command service (CQRS-lite: writes) — the settlement half of the
 * pay loop. 042 freezes what a week is WORTH at approval; this records that
 * it was PAID (migration 066, `docs/11-MONEY.md` §1/§3/§8/§9).
 *
 * ONE method, four gates, in this order — and the order decides which error
 * a caller is allowed to see:
 *
 * 1. **The week must exist and be the caller's.** `timesheet_id` arrives from
 *    the URL: a client-supplied foreign id on a write, the exact shape of
 *    defects D12/D14. Repositories run as the service role and 066 has no
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
 *    cannot be a row CHECK, so this service IS that constraint (066's
 *    header). Over-payment is REFUSED, never clamped (§1) — a trimmed
 *    payment is a record of money that did not move.
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
 * editing history (066's header, the same discipline as 041/043).
 *
 * ponytail: the gate is read-then-write, so two simultaneous first payments
 * could each see `sum = 0` and both commit, together exceeding the gross.
 * Sequential retries never reach it (the first row is visible by then), and
 * the window is two parents tapping "Record payment" in the same instant.
 * Closing it needs a 051-style database function that sums and inserts in one
 * statement; the honest fix is that, not a wider pre-check.
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
    const week = this.assertApprovedAndPriced(timesheet);
    await this.assertWithinGross(timesheetId, input.amount_minor, week);

    const payment = await this.paymentRepo.create({
      timesheet_id: timesheet.id,
      household_id: timesheet.household_id,
      carer_id: timesheet.carer_id,
      amount_minor: input.amount_minor,
      currency: week.currency,
      paid_at: input.paid_at,
      // Written explicitly rather than omitted: the column is nullable and
      // "the parent said nothing about how" is a fact worth stating.
      method_note: input.method_note ?? null,
      recorded_by: callerId,
    });

    this.notifyCarerOfPayment(timesheet);
    return payment;
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

  /** Gate 4 — see the module doc. Refuses; never clamps. */
  private async assertWithinGross(
    timesheetId: string,
    amountMinor: number,
    week: PayableWeek
  ): Promise<void> {
    const alreadyPaidMinor =
      await this.paymentRepo.sumForTimesheet(timesheetId);
    if (alreadyPaidMinor + amountMinor > week.grossMinor) {
      throw new PaymentExceedsGrossError(
        timesheetId,
        amountMinor,
        alreadyPaidMinor,
        week.grossMinor
      );
    }
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

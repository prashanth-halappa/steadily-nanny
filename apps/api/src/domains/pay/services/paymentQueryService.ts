/**
 * Payment query service (CQRS-lite: reads only) — what a week has actually
 * been paid.
 *
 * READ GATING — who may see a week's settlement history:
 *
 * | caller                                   | sees                |
 * |------------------------------------------|---------------------|
 * | active `owner`/`parent` of the household | the week's payments |
 * | the week's OWN carer                     | the week's payments |
 * | another `nanny` of the same household    | denied              |
 * | `helper`                                 | denied              |
 * | non-member                               | denied              |
 *
 * That table is migration 066's select policy —
 * `private.can_write_household(household_id) or carer_id = (select auth.uid())`
 * — restated in the service, and the restatement is the point. Repositories
 * run as the service role and bypass RLS entirely, so the policy is a
 * backstop, not the check (`docs/11-MONEY.md` §8/§9): a service LOOSER than
 * the policy on the same table is a real hole. It is deliberately NARROWER
 * than `timesheetQueryService`'s "any active member may read" gate on
 * `GET /timesheets/:id` — hours are a household-wide fact, but a helper must
 * never see money and one nanny must never see another's, which is the one
 * rule every money read in this domain shares
 * (`payArrangementQueryService`, `ptoQueryService`, `expenseQueryService`).
 *
 * THE CARER ARM IS MEMBERSHIP-INDEPENDENT, exactly like the policy's
 * `carer_id = auth.uid()`: a carer who has since been removed still reads the
 * weeks she was paid for. Payroll is an audit trail, the same argument
 * `timesheetQueryService.assertPayrollReader` makes — and unlike that gate,
 * no removed-parent arm is needed here, because a parent who is gone has no
 * active membership and no row of her own to arm on.
 *
 * Every denial — missing week, non-member, helper, another nanny — raises the
 * SAME `PaymentNotFoundError`, so a caller learns nothing about a household
 * or a week that isn't hers.
 *
 * @module domains/pay/services/paymentQueryService
 */
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { HOUSEHOLD_ROLES, HouseholdMemberRepository } from '../../household';
// Concrete cross-domain import, never the timesheet barrel — see the note in
// `paymentCommandService.ts` and in this domain's barrel.
import { TimesheetRepository } from '../../timesheet/repositories/timesheetRepository';
import { PaymentNotFoundError } from '../errors/payErrors';
import { PaymentRepository } from '../repositories/paymentRepository';

/** Roles that read EVERY carer's money in the household. */
const PAYMENT_READ_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

export class PaymentQueryService {
  constructor(
    private readonly paymentRepo: PaymentRepository = new PaymentRepository(),
    private readonly timesheetRepo: TimesheetRepository = new TimesheetRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /** Every payment recorded against one week, oldest first. */
  async listForTimesheet(
    callerId: string,
    timesheetId: string
  ): Promise<Payment[]> {
    await this.assertCanRead(callerId, timesheetId);
    return this.paymentRepo.listForTimesheet(timesheetId);
  }

  /** The gate in the module doc, and nothing else. */
  private async assertCanRead(
    callerId: string,
    timesheetId: string
  ): Promise<void> {
    const timesheet = await this.timesheetRepo.findById(timesheetId);
    if (!timesheet) {
      throw new PaymentNotFoundError(timesheetId, {
        reason: 'timesheet_not_found',
      });
    }
    // The carer arm first, and without a membership lookup: 066's policy arms
    // on the ROW, so a removed carer keeps reading the week she was paid for.
    if (timesheet.carer_id && timesheet.carer_id === callerId) {
      return;
    }
    const membership = await this.memberRepo.findActiveMembership(
      timesheet.household_id,
      callerId
    );
    if (!membership || !PAYMENT_READ_ROLES.has(membership.role)) {
      throw new PaymentNotFoundError(timesheetId, {
        reason: 'not_a_payment_reader',
      });
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const paymentQueryService = new PaymentQueryService();

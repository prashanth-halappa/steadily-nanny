/**
 * Payment query service (CQRS-lite: reads only) — what a week, or a whole
 * household, has actually been paid.
 *
 * TWO reads, TWO gates, and they are deliberately not the same gate:
 * `listForTimesheet` answers "what was THIS week paid" and arms on the week's
 * own `carer_id` (`assertCanRead`); `listForHousehold` answers "what has this
 * household paid, ever" and arms on the caller's MEMBERSHIP, resolving a
 * scope rather than a yes/no (`assertPaymentReader`). A row-armed check
 * cannot express "every carer's rows", and a membership-armed check cannot
 * express "the carer of this particular week", so neither collapses into the
 * other.
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
 * That table is migration 067's select policy —
 * `private.can_write_household(household_id) or carer_id = (select auth.uid())`
 * — restated in the service, and the restatement is the point. Repositories
 * run as the service role and bypass RLS entirely, so the policy is a
 * backstop, not the check (`docs/11-MONEY.md` §8/§9): a service LOOSER than
 * the policy on the same table is a real hole.
 *
 * It used to be deliberately NARROWER than `timesheetQueryService`'s gate on
 * `GET /timesheets/:id`, which granted household scope to ANY active member.
 * As of D-21 it is not narrower — it is the SAME, because that gate moved to
 * match this one (a `timesheets` row carries the frozen gross, so "hours are a
 * household-wide fact" stopped being true the day 042 landed). A helper must
 * never see money and one nanny must never see another's; that is now the one
 * rule EVERY payroll read in this repo shares — this service,
 * `payArrangementQueryService`, `ptoQueryService`, `expenseQueryService` and
 * `timesheetQueryService.assertPayrollReader`. Change one, change all five.
 *
 * THE CARER ARM IS MEMBERSHIP-INDEPENDENT, exactly like the policy's
 * `carer_id = auth.uid()`: a carer who has since been removed still reads the
 * weeks she was paid for. Payroll is an audit trail, the same argument
 * `timesheetQueryService.assertPayrollReader` makes — and unlike that gate,
 * no removed-parent arm is needed here, because a parent who is gone has no
 * active membership and no row of her own to arm on.
 *
 * READ GATING — who may see the HOUSEHOLD's settlement history
 * (`listForHousehold`, `assertPaymentReader`):
 *
 * | caller                       | sees                          |
 * |------------------------------|-------------------------------|
 * | `owner`/`parent`, any status | every carer's payments        |
 * | `nanny`, any status          | HER OWN rows, and only hers   |
 * | `helper`, any status         | denied                        |
 * | non-member                   | denied                        |
 *
 * That is `timesheetQueryService.assertPayrollReader` restated on the money
 * table, membership status and all — read its doc for why a REMOVED member
 * keeps a payroll read at all. The carer scope is FORCED, not offered: the
 * repo is called with her own id whatever filter arrives, so a nanny cannot
 * widen her scope to the household's.
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

/**
 * What `assertPaymentReader` resolved: every carer's rows, or one carer's.
 * Same shape and same purpose as `timesheetQueryService`'s `PayrollReadScope`
 * and `expenseQueryService`'s `ReadScope`.
 */
type PaymentReadScope =
  | { kind: 'household' }
  | { kind: 'own'; carerId: string };

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

  /**
   * A household's payments, newest first — every carer's, or just the
   * caller's own, whichever `assertPaymentReader` resolved.
   *
   * The scope OVERRIDES the client-supplied `carerId`, never merely defaults
   * it: a nanny handed carer-2's id would otherwise read carer-2's pay.
   * Same enforcement point as
   * `timesheetQueryService.listTimesheetsForHousehold`.
   */
  async listForHousehold(
    callerId: string,
    householdId: string,
    carerId?: string
  ): Promise<Payment[]> {
    const scope = await this.assertPaymentReader(callerId, householdId);
    return this.paymentRepo.listForHousehold(
      householdId,
      scope.kind === 'own' ? scope.carerId : carerId
    );
  }

  /**
   * Who may read a HOUSEHOLD's payroll — `assertPayrollReader`'s gate
   * (`timesheetQueryService`) restated on the money table, and deliberately
   * NOT `assertCanRead`'s gate below.
   *
   * `findMembershipAnyStatus`, never `findActiveMembership`: a carer who has
   * since been removed must still read what she was paid. That is the same
   * argument 067's row-armed `carer_id = auth.uid()` policy makes and the
   * same one `assertPayrollReader` makes about hours — payroll is an audit
   * trail, not a live surface that vanishes with the badge. A removed
   * owner/parent keeps the household view for the same reason.
   *
   * A `candidate` is refused from 3-O, and by the LOOKUP rather than by an arm
   * below: `findMembershipAnyStatus` filters positively to `{active, removed}`,
   * so a nanny whose terms nobody has agreed yet reads null here and takes the
   * same opaque 404 a stranger takes. There is no audit trail to keep for
   * somebody who has not been paid anything (D-49).
   *
   * A helper is denied in BOTH statuses: she never had a money surface to
   * keep (the rule every read in this domain shares). Every denial is the
   * SAME `PaymentNotFoundError`, so a non-member learns nothing about a
   * household that isn't hers — the reason lives in the metadata.
   */
  private async assertPaymentReader(
    callerId: string,
    householdId: string
  ): Promise<PaymentReadScope> {
    const membership = await this.memberRepo.findMembershipAnyStatus(
      householdId,
      callerId
    );
    if (!membership) {
      throw new PaymentNotFoundError(householdId, {
        householdId,
        reason: 'household_not_accessible',
      });
    }
    if (PAYMENT_READ_ROLES.has(membership.role)) {
      return { kind: 'household' };
    }
    if (membership.role === HOUSEHOLD_ROLES.NANNY) {
      return { kind: 'own', carerId: callerId };
    }
    // A helper, active or removed — no money surface, ever.
    throw new PaymentNotFoundError(householdId, {
      householdId,
      reason: 'not_a_payment_reader',
    });
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
    // The carer arm first, and without a membership lookup: 067's policy arms
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

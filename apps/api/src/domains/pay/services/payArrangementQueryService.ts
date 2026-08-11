/**
 * Pay arrangement query service (CQRS-lite: reads only).
 *
 * READ GATING — who may see what a carer is paid:
 *
 * | caller                                   | allowed |
 * |------------------------------------------|---------|
 * | `owner`/`parent` of the household        | yes     |
 * | the carer herself (`callerId === carerId`, a `nanny`) | yes |
 * | another `nanny` of the same household    | no      |
 * | `helper`                                 | no      |
 * | non-member                               | no      |
 *
 * MEMBERSHIP STATUS IS NOT PART OF THAT TABLE — a `removed` member reads
 * exactly what her role always let her read. The terms she worked under are
 * an audit trail she does not stop being entitled to when the badge is
 * revoked, and the parents who paid keep their view. Every WRITE
 * (`payArrangementCommandService`) still requires an ACTIVE membership.
 *
 * The carer's own arm is deliberate, not a concession: opaque pay is the
 * disease this feature treats, and migration 041's SELECT policy lets every
 * member read the row for exactly that reason. HELPERS ARE DENIED — a helper
 * is a babysitter or grandparent with schedule access, and the CX spec gives
 * that role no pay surface at all; since repositories run as the service role
 * and bypass RLS, this service is the only thing standing between a helper and
 * a nanny's rate.
 *
 * Every denial — and "no such household", "no such carer", "not your carer" —
 * raises the SAME `PayArrangementNotFoundError`, so a caller learns nothing
 * about carers who are not hers (see that error's doc).
 *
 * @module domains/pay/services/payArrangementQueryService
 */
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import { localDateOf } from '../../timesheet/utils/weekStart';
import { PayArrangementNotFoundError } from '../errors/payErrors';
import { PayArrangementRepository } from '../repositories/payArrangementRepository';
import type { PayArrangement } from '../types';

/** Roles that may read ANY carer's pay in the household. */
const PAY_READ_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

export class PayArrangementQueryService {
  constructor(
    private readonly payRepo: PayArrangementRepository = new PayArrangementRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository()
  ) {}

  /**
   * The arrangement in force TODAY, or null when the carer has none yet.
   *
   * Null is the honest answer and the caller must render it as "no rate set",
   * never as £0.00 (docs/11-MONEY.md §4) — a silently wrong zero is the worst
   * output a pay feature can produce.
   *
   * "Today" is the household's LOCAL date, not the server's: a household east
   * of UTC is already on tomorrow's terms at 23:30Z, and resolving in UTC
   * would hand it yesterday's rate for those hours. `now` is injectable purely
   * for deterministic tests of that boundary — production callers never pass
   * it (same convention as `timesheetCommandService.clockIn`).
   */
  async getCurrent(
    callerId: string,
    householdId: string,
    carerId: string,
    now: () => Date = () => new Date()
  ): Promise<PayArrangement | null> {
    await this.assertCanReadPay(callerId, householdId, carerId);
    const household = await this.householdRepo.findById(householdId);
    const today = localDateOf(now(), household?.timezone ?? 'UTC');
    return this.payRepo.effectiveOn(householdId, carerId, today);
  }

  /**
   * The append-only history, newest first — the audit trail behind the current
   * number, which is the whole point of never mutating a row.
   */
  async getHistory(
    callerId: string,
    householdId: string,
    carerId: string
  ): Promise<PayArrangement[]> {
    await this.assertCanReadPay(callerId, householdId, carerId);
    return this.payRepo.listForCarer(householdId, carerId);
  }

  /**
   * The single read gate for this domain (see the module doc's table). Kept
   * private and called at the top of every method so no future read can
   * accidentally ship without it.
   *
   * IS-OR-WAS-A-MEMBER ON PURPOSE: a `removed` member keeps her role's read
   * scope. The role arms below do all the narrowing — a removed nanny still
   * has to satisfy `callerId === carerId`, so she reaches her own terms and no
   * one else's.
   *
   * A `candidate` is refused here from 3-O, and by the LOOKUP rather than
   * by an arm below: `findMembershipAnyStatus` filters positively to
   * `{active, removed}`, so a nanny whose terms nobody has agreed yet
   * reads null and lands on the same opaque 404 a stranger gets. She has
   * no money trail here to keep (D-49).
   */
  private async assertCanReadPay(
    callerId: string,
    householdId: string,
    carerId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findMembershipAnyStatus(
      householdId,
      callerId
    );
    if (!membership) {
      throw new PayArrangementNotFoundError(householdId, carerId, {
        reason: 'household_not_accessible',
      });
    }
    if (PAY_READ_ROLES.has(membership.role)) {
      return;
    }
    // The only non-parent arm: the carer reading her own terms. A helper never
    // reaches it (she is not the carer of any arrangement), and neither does a
    // second nanny asking about the first.
    if (callerId === carerId && membership.role === HOUSEHOLD_ROLES.NANNY) {
      return;
    }
    throw new PayArrangementNotFoundError(householdId, carerId, {
      reason: 'pay_not_visible_to_role',
    });
  }
}

// Singleton for controllers/routes that don't need DI.
export const payArrangementQueryService = new PayArrangementQueryService();

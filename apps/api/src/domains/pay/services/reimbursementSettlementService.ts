/**
 * Reimbursement settlement service — the record that a household paid a carer
 * BACK for what she spent (D-14, gap P7, migration 086, attention spec §4.2).
 *
 * ---------------------------------------------------------------------------
 * REIMBURSEMENT SETTLEMENTS ARE NOT PAYMENTS. They are excluded from gross,
 * from payable minutes and from the payment ceiling because they are the
 * family repaying money she already spent, not wages. Do not merge these
 * tables, do not sum them into paid-to-date.
 * ---------------------------------------------------------------------------
 *
 * That guard is required verbatim in substance by spec §4.2, and it is not
 * decoration: a settled reimbursement and a recorded payment have the same
 * shape on screen — date, amount, note, who recorded it — and "why are there
 * two tables for money going to the same person" is the question that precedes
 * the merge. The answer is that one of them is wages and one of them is not,
 * and the day they share a ceiling the money engine is wrong in the direction
 * nobody notices until a nanny is underpaid.
 *
 * ONE FILE, query and command together, deliberately: the whole domain is one
 * read and one write, and the CQRS-lite split earns its keep only once the
 * write side has non-trivial logic of its own to keep away from the reads
 * (`timesheetQueryService`/`timesheetCommandService`). Splitting two methods
 * across two files would be shape without substance.
 *
 * READ GATING (086's select policy —
 * `private.can_write_household(household_id) or carer_id = auth.uid()` —
 * restated on the service side, because repositories bypass RLS and a service
 * LOOSER than the policy is a real hole, `docs/11-MONEY.md` §8/§9):
 *
 * | caller                       | sees                        |
 * |------------------------------|-----------------------------|
 * | `owner`/`parent`, any status | every carer's settlements   |
 * | `nanny`, any status          | HER OWN rows, and only hers |
 * | `helper`, any status         | denied                      |
 * | non-member                   | denied                      |
 *
 * ANY-STATUS ON THE READ, matching `expenseQueryService`/`paymentQueryService`:
 * a removed member keeps her role's read, because payroll is an audit trail
 * and a nanny who has left must still be able to see what she was repaid. The
 * carer scope is FORCED, not defaulted — her own id whatever the request says.
 *
 * WRITE GATING, in this order (mirroring `paymentCommandService`):
 * 1. ACTIVE membership, or the opaque 404. A removed parent cannot settle.
 * 2. Parents/owner only, or the 403 `NotAHouseholdParentError`. A helper
 *    cannot touch money, and the nanny cannot mark her own repayment done.
 * 3. The amount is COMPUTED from the approved expense rows for that
 *    carer-week — the client sends no figure, so there is nothing to spoof.
 *    A zero sum is REFUSED (`NothingToSettleError`), never written as £0.00
 *    and never clamped up to 086's `amount_minor >= 1` floor.
 * 4. The currency is stamped from the HOUSEHOLD row, and any approved claim
 *    disagreeing with it refuses the whole week rather than summing across
 *    currencies or dropping the odd row.
 * 5. The insert; the unique index answers the double-tap race with an
 *    `AlreadySettledError` the repository translates.
 *
 * APPEND-ONLY. There is no update, no delete and no correction method here,
 * and none should be added before someone has needed one (spec §4.2 — YAGNI;
 * 085's correction path exists one table over).
 *
 * @module domains/pay/services/reimbursementSettlementService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  CreateReimbursementSettlementInput,
  ReimbursementSettlement,
  UnsettledReimbursementWeek,
} from '@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import { notifyUser } from '../../notification/services/householdPush';
import type { PushPayload } from '../../notification/types';
import { TimesheetNotFoundError } from '../../timesheet/errors/timesheetErrors';
import {
  type PayrollReadScope,
  timesheetQueryService,
} from '../../timesheet/services/timesheetQueryService';
import { carerKeyOf } from '../../timesheet/utils/carerKey';
import {
  DEFAULT_WEEK_STARTS_ON,
  weekEndExclusive,
  weekStartOf,
  weekStartOfLocalDate,
} from '../../timesheet/utils/weekStart';
import {
  NothingToSettleError,
  ReimbursementSettlementNotFoundError,
  SettlementCurrencyMismatchError,
} from '../errors/payErrors';
import { ExpenseRepository } from '../repositories/expenseRepository';
import { ReimbursementSettlementRepository } from '../repositories/reimbursementSettlementRepository';

/** Injectable push seam — defaults to the fire-and-forget household helper. */
export interface SettlementPushNotifier {
  notifyUser: (userId: string, payload: PushPayload) => void;
}

/** Roles that read EVERY carer's settlements, and the only roles that may write. */
const SETTLEMENT_PARENT_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/** What the read gate resolved: everyone's rows, or one carer's. */
type ReadScope = { kind: 'household' } | { kind: 'own'; carerId: string };

/** Injectable payroll-read gate — defaults to `timesheetQueryService`. */
export interface PayrollReadScopeResolver {
  resolvePayrollReadScope(
    userId: string,
    householdId: string
  ): Promise<PayrollReadScope>;
}

export class ReimbursementSettlementService {
  constructor(
    private readonly settlementRepo: ReimbursementSettlementRepository = new ReimbursementSettlementRepository(),
    private readonly expenseRepo: ExpenseRepository = new ExpenseRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly push: SettlementPushNotifier = { notifyUser },
    private readonly payrollReader: PayrollReadScopeResolver = timesheetQueryService
  ) {}

  /**
   * A household's settlements for the household-local week containing
   * `weekStart` (or, omitted, the CURRENT household-local week). `now` is
   * injectable purely for deterministic tests of the local "today" boundary,
   * the same convention as `expenseQueryService.listForWeek`; production
   * callers never pass it.
   */
  async listForWeek(
    callerId: string,
    householdId: string,
    weekStart: string | undefined,
    now: () => Date = () => new Date()
  ): Promise<ReimbursementSettlement[]> {
    const scope = await this.assertCanRead(callerId, householdId);
    const resolvedWeekStart =
      weekStart ?? (await this.currentWeekStart(householdId, now));
    const rows = await this.settlementRepo.listForWeek(
      householdId,
      resolvedWeekStart
    );
    if (scope.kind === 'household') {
      return rows;
    }
    return rows.filter(row => row.carer_id === scope.carerId);
  }

  /**
   * Every household-local week with approved reimbursements that have NOT been
   * settled yet — one row per (carer, week_start) with the owed total in
   * integer minor units. READ GATING: `timesheetQueryService.assertPayrollReader`
   * via `resolvePayrollReadScope` — parents see every carer, a nanny only hers,
   * a helper gets the opaque 404. Weeks with nothing owed return an empty list,
   * never a zero row; currency-mismatched weeks are omitted entirely.
   */
  async listUnsettled(
    callerId: string,
    householdId: string
  ): Promise<UnsettledReimbursementWeek[]> {
    const scope = await this.resolvePayrollReadScope(callerId, householdId);

    const household = await this.householdRepo.findById(householdId);
    if (!household) {
      throw new ReimbursementSettlementNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }

    const weekStartsOn = household.week_starts_on ?? DEFAULT_WEEK_STARTS_ON;
    const householdCurrency = household.currency;

    const approved =
      await this.expenseRepo.listApprovedForHousehold(householdId);
    const settlements = await this.settlementRepo.listForHousehold(householdId);

    // 086 predates 058 and has NO `household_member_id`, so a settlement for a
    // carer who has since deleted her account can no longer name her: all that
    // survives is `(household_id, NULL, week_start)`. Live carers therefore key
    // exactly; departed ones are COUNTED per week and reconciled below.
    const settledKeys = new Set<string>();
    const departedSettlementsPerWeek = new Map<string, number>();
    for (const row of settlements) {
      if (row.carer_id) {
        settledKeys.add(`${row.carer_id}:${row.week_start}`);
      } else {
        departedSettlementsPerWeek.set(
          row.week_start,
          (departedSettlementsPerWeek.get(row.week_start) ?? 0) + 1
        );
      }
    }

    const grouped = new Map<
      string,
      {
        carerId: string | null;
        householdMemberId: string | null;
        carerDisplayName: string;
        weekStart: string;
        total: number;
        currencies: Set<string>;
      }
    >();

    for (const claim of approved) {
      // NO `!claim.carer_id` SKIP (033). The claim was approved, the money was
      // spent and the family still owes it — her deleting her account settles
      // nothing. The bucket key is the same coalesce 061/069 use in SQL and
      // `carerKey.ts` uses on the client, so two departed carers stay two rows.
      if (scope.kind === 'own' && claim.carer_id !== scope.carerId) {
        continue;
      }
      const weekStart = weekStartOfLocalDate(claim.local_date, weekStartsOn);
      const key = `${carerKeyOf(claim)}:${weekStart}`;
      if (claim.carer_id && settledKeys.has(`${claim.carer_id}:${weekStart}`)) {
        continue;
      }
      if (claim.amount_minor == null) {
        continue;
      }

      const bucket = grouped.get(key) ?? {
        carerId: claim.carer_id,
        householdMemberId: claim.household_member_id ?? null,
        carerDisplayName: claim.carer_display_name,
        weekStart,
        total: 0,
        currencies: new Set<string>(),
      };
      bucket.total += claim.amount_minor;
      bucket.currencies.add(claim.currency);
      grouped.set(key, bucket);
    }

    // Every carer-less settlement in a week belongs to SOME departed bucket in
    // that week (the write path only ever sums a real carer's approved claims,
    // so a settlement implies claims). When the counts match, all of them are
    // accounted for and the week is quiet. When they do not, we cannot tell
    // WHICH are settled — so we report them all. Over-reporting a repayment is
    // visible and correctable; hiding one is a nanny who is never paid back.
    //
    // ponytail: exact attribution needs 058's `household_member_id` stamped on
    // `reimbursement_settlements`, which 086 never got. Add that column and
    // this whole reconciliation collapses back into `settledKeys`.
    const departedBucketsPerWeek = new Map<string, number>();
    for (const bucket of grouped.values()) {
      if (bucket.carerId === null) {
        departedBucketsPerWeek.set(
          bucket.weekStart,
          (departedBucketsPerWeek.get(bucket.weekStart) ?? 0) + 1
        );
      }
    }

    const weeks: UnsettledReimbursementWeek[] = [];
    for (const bucket of grouped.values()) {
      if (bucket.total === 0) {
        continue;
      }
      if (
        bucket.carerId === null &&
        departedSettlementsPerWeek.get(bucket.weekStart) ===
          departedBucketsPerWeek.get(bucket.weekStart)
      ) {
        continue;
      }
      if (
        bucket.currencies.size !== 1 ||
        !bucket.currencies.has(householdCurrency)
      ) {
        continue;
      }
      weeks.push({
        carer_id: bucket.carerId,
        household_member_id: bucket.householdMemberId,
        carer_display_name: bucket.carerDisplayName,
        week_start: bucket.weekStart,
        amount_minor: bucket.total,
        currency: householdCurrency,
      });
    }

    weeks.sort((a, b) => {
      const byWeek = a.week_start.localeCompare(b.week_start);
      if (byWeek !== 0) {
        return byWeek;
      }
      // The same coalesce again — `a.carer_id.localeCompare` would throw on a
      // departed carer, which is how an aggregate becomes a 500.
      return carerKeyOf(a).localeCompare(carerKeyOf(b));
    });

    return weeks;
  }

  /**
   * Record that this household repaid one carer's approved reimbursements for
   * one week. Gates 1–5 of the module doc, in that order.
   */
  async create(
    callerId: string,
    householdId: string,
    input: CreateReimbursementSettlementInput
  ): Promise<ReimbursementSettlement> {
    await this.assertCanSettle(callerId, householdId);

    const household = await this.householdRepo.findById(householdId);
    if (!household) {
      // Unreachable behind gate 1 (a membership implies a household), but the
      // currency below must come off a real row or not at all — never a
      // default, which would label the money wrong (docs/11-MONEY.md §1).
      throw new ReimbursementSettlementNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }

    const amountMinor = await this.sumApprovedForCarerWeek(
      householdId,
      input,
      household.currency
    );

    const settlement = await this.settlementRepo.create({
      household_id: householdId,
      carer_id: input.carer_id,
      week_start: input.week_start,
      amount_minor: amountMinor,
      currency: household.currency,
      settled_at: input.settled_at,
      // Explicit null rather than omitted: the column is nullable and "the
      // parent said nothing about how" is a fact worth stating.
      note: input.note ?? null,
      recorded_by: callerId,
    });

    this.notifyCarerOfSettlement(settlement);
    return settlement;
  }

  /**
   * Gates 3 and 4 — the amount, computed server-side, and the currency it is
   * denominated in.
   *
   * The sum is an INTEGER FOLD over `amount_minor` (`docs/11-MONEY.md` §1):
   * no division, no float, no rounding, so the total is exact by
   * construction. 063's `amount_minor <= 99999999` cap is enforced by the
   * column check rather than restated here — a sum past it is refused by the
   * database, never clamped, which is the invariant that matters.
   *
   * A NULL `amount_minor` on an approved row is SKIPPED, matching
   * `buildWeekEarningsInput`'s identical skip. 044's approval write freezes a
   * mileage row's amount in the same statement as the status flip, so such a
   * row should not exist — but if one ever does, this figure and the one on
   * `ReimbursementsCard` (which the earnings fold produces) MUST agree.
   * Settling for more than the card shows is the worse of the two failures:
   * it records a repayment neither side can reconcile against the statement.
   */
  private async sumApprovedForCarerWeek(
    householdId: string,
    input: CreateReimbursementSettlementInput,
    householdCurrency: string
  ): Promise<number> {
    const approved = await this.expenseRepo.listApprovedForWeek(
      householdId,
      input.week_start,
      weekEndExclusive(input.week_start)
    );
    const hers = approved.filter(row => row.carer_id === input.carer_id);

    for (const claim of hers) {
      if (claim.currency !== householdCurrency) {
        throw new SettlementCurrencyMismatchError(
          householdId,
          input.carer_id,
          input.week_start,
          householdCurrency,
          claim.currency
        );
      }
    }

    const total = hers.reduce(
      (sum, claim) => sum + (claim.amount_minor ?? 0),
      0
    );
    if (total === 0) {
      throw new NothingToSettleError(
        householdId,
        input.carer_id,
        input.week_start
      );
    }
    return total;
  }

  /**
   * The first day of the household's own workweek for the week containing
   * `now()` — BOTH the zone and the start day come off the household row,
   * never a hardcoded Monday. The `??`s fire only when the row fails to load.
   */
  private async currentWeekStart(
    householdId: string,
    now: () => Date
  ): Promise<string> {
    const household = await this.householdRepo.findById(householdId);
    return weekStartOf(
      now(),
      household?.timezone ?? 'UTC',
      household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON
    );
  }

  /**
   * `timesheetQueryService.assertPayrollReader`, restated as a cross-domain read
   * gate — see `listUnsettled`. Maps `TimesheetNotFoundError` to this domain's
   * opaque 404 so callers learn nothing about a household that isn't theirs.
   */
  private async resolvePayrollReadScope(
    callerId: string,
    householdId: string
  ): Promise<PayrollReadScope> {
    try {
      return await this.payrollReader.resolvePayrollReadScope(
        callerId,
        householdId
      );
    } catch (error) {
      if (error instanceof TimesheetNotFoundError) {
        throw new ReimbursementSettlementNotFoundError(householdId, {
          reason:
            (error.metadata?.reason as string | undefined) ??
            'household_not_accessible',
        });
      }
      throw error;
    }
  }

  /**
   * The read gate — see the module doc's table. Any membership status that
   * means "is, or once was, a member here": `findMembershipAnyStatus` filters
   * positively to `{active, removed}`, so a 3-O `candidate` reads null and
   * gets the same opaque 404 a stranger gets (D-49).
   */
  private async assertCanRead(
    callerId: string,
    householdId: string
  ): Promise<ReadScope> {
    const membership = await this.memberRepo.findMembershipAnyStatus(
      householdId,
      callerId
    );
    if (!membership) {
      throw new ReimbursementSettlementNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }
    if (SETTLEMENT_PARENT_ROLES.has(membership.role)) {
      return { kind: 'household' };
    }
    if (membership.role === HOUSEHOLD_ROLES.NANNY) {
      return { kind: 'own', carerId: callerId };
    }
    throw new ReimbursementSettlementNotFoundError(householdId, {
      reason: 'settlements_not_visible_to_role',
    });
  }

  /**
   * Write gates 1 and 2. A non-member gets the 404, not the 403: telling a
   * stranger "you are not a parent OF THIS HOUSEHOLD" confirms the household
   * is real. A member with the wrong role gets the 403, because she already
   * knows it is.
   */
  private async assertCanSettle(
    callerId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      callerId
    );
    if (!membership) {
      throw new ReimbursementSettlementNotFoundError(householdId, {
        reason: 'not_an_active_household_member',
      });
    }
    if (!SETTLEMENT_PARENT_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(householdId, membership.role);
    }
  }

  /**
   * Fire-and-forget push to the carer who was just repaid — never a household
   * fan-out: the parent recording it already knows, and a repayment is her
   * news. `notifyUser` swallows delivery errors internally; the try/catch is
   * belt-and-braces against an unexpected SYNCHRONOUS throw, matching
   * `paymentCommandService.notifyCarerOfPayment`.
   *
   * NO FIGURE IN THE TITLE OR BODY (A8). A lock-screen preview is not a
   * private surface, and the amount is one tap away in the app.
   *
   * A carer-less row (033: she deleted her account) has nobody to notify.
   */
  private notifyCarerOfSettlement(settlement: ReimbursementSettlement): void {
    if (!settlement.carer_id) {
      return;
    }
    try {
      this.push.notifyUser(settlement.carer_id, {
        title: 'Reimbursement repaid',
        body: 'A parent recorded that your approved expenses were paid back.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.REIMBURSEMENT_SETTLED,
          householdId: settlement.household_id,
          weekStart: settlement.week_start,
        },
      });
    } catch {
      // notifyUser is sync fire-and-forget; swallow any unexpected throw.
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const reimbursementSettlementService =
  new ReimbursementSettlementService();

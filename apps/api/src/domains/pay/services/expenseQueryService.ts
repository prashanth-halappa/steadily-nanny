/**
 * Expense query service (CQRS-lite: reads only).
 *
 * READ GATING — who may see what expenses/mileage a carer has claimed:
 *
 * | caller                                   | sees                        |
 * |-------------------------------------------|-----------------------------|
 * | `owner`/`parent` of the household        | every carer's claims        |
 * | the carer herself (`callerId === carer_id of a row`) | her OWN rows only |
 * | another `nanny` of the same household    | denied entirely             |
 * | `helper`                                 | denied entirely             |
 * | non-member                               | denied entirely             |
 *
 * MEMBERSHIP STATUS IS NOT PART OF THAT TABLE — a `removed` member reads
 * exactly what her role always let her read. Payroll is an audit trail: a
 * nanny who has left must still be able to see what she claimed and was
 * owed, and the parents who paid keep the household-wide view. Only the read
 * side is any-status; every WRITE (`expenseCommandService`) still resolves an
 * ACTIVE membership, so a removed member can look but never file, edit, or
 * approve a claim.
 *
 * Same shape as `payArrangementQueryService`'s table (`docs/11-MONEY.md`
 * §8): a helper never sees money, and one nanny never sees another's claims.
 * The repository queries below are HOUSEHOLD-scoped, never carer-scoped, so
 * a nanny's own-rows view is enforced by filtering IN THIS SERVICE after the
 * fetch — repositories bypass RLS, so this filter (not the query) is what
 * actually keeps her from seeing carer-2's claims.
 *
 * Every denial — "no such household", "not a member", "a helper", "another
 * nanny" — raises the SAME `ExpenseNotFoundError`, so a caller learns
 * nothing about a household or carer that isn't hers.
 *
 * @module domains/pay/services/expenseQueryService
 */
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import {
  DEFAULT_WEEK_STARTS_ON,
  weekEndExclusive,
  weekStartOf,
} from '../../timesheet/utils/weekStart';
import { ExpenseNotFoundError } from '../errors/payErrors';
import { ExpenseRepository } from '../repositories/expenseRepository';

/** Roles that may read EVERY carer's expenses in the household. */
const EXPENSE_READ_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/** What `assertCanRead` resolved: everyone's rows, or just one carer's. */
type ReadScope = { kind: 'household' } | { kind: 'own'; carerId: string };

export class ExpenseQueryService {
  constructor(
    private readonly expenseRepo: ExpenseRepository = new ExpenseRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository()
  ) {}

  /**
   * A household's expenses/mileage for the household-local week containing
   * `weekStart` (or, if omitted, the CURRENT household-local week) —
   * `[weekStart, weekStart+7)`, every status. `now` is injectable purely for
   * deterministic tests of the household-local "today" boundary (same
   * convention as `payArrangementQueryService.getCurrent`); production
   * callers never pass it.
   */
  async listForWeek(
    callerId: string,
    householdId: string,
    weekStart: string | undefined,
    now: () => Date = () => new Date()
  ): Promise<Expense[]> {
    const scope = await this.assertCanRead(callerId, householdId);
    const resolvedWeekStart =
      weekStart ?? (await this.currentWeekStart(householdId, now));
    const rows = await this.expenseRepo.listForWeek(
      householdId,
      resolvedWeekStart,
      weekEndExclusive(resolvedWeekStart)
    );
    return this.scopeRows(rows, scope);
  }

  /** The household's pending review queue (parent view), or the carer's own pending claims. */
  async listPending(callerId: string, householdId: string): Promise<Expense[]> {
    const scope = await this.assertCanRead(callerId, householdId);
    const rows = await this.expenseRepo.listPending(householdId);
    return this.scopeRows(rows, scope);
  }

  /**
   * Approved claims for a household-local week — the reimbursement
   * section's source rows (`docs/11-MONEY.md` §6). Exposed here,
   * caller-gated, as a convenience read; the earnings wrapper that freezes
   * the weekly statement composes directly against
   * `expenseRepository.listApprovedForWeek` instead, the same way
   * `weekEarningsService` composes against `payArrangementRepository`
   * rather than `payArrangementQueryService`.
   */
  async listApprovedForWeek(
    callerId: string,
    householdId: string,
    weekStart: string | undefined,
    now: () => Date = () => new Date()
  ): Promise<Expense[]> {
    const scope = await this.assertCanRead(callerId, householdId);
    const resolvedWeekStart =
      weekStart ?? (await this.currentWeekStart(householdId, now));
    const rows = await this.expenseRepo.listApprovedForWeek(
      householdId,
      resolvedWeekStart,
      weekEndExclusive(resolvedWeekStart)
    );
    return this.scopeRows(rows, scope);
  }

  /**
   * The first day of the household's own workweek for the week containing
   * `now()` — BOTH the zone and the start day come off the household row
   * (§5 D-8), never a hardcoded Monday. The `??`s fire only when the row
   * fails to load.
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
   * The single read gate for this domain (see the module doc's table).
   * Returns the SCOPE the caller is entitled to rather than a boolean, so
   * every read method narrows its rows the same way.
   *
   * IS-OR-WAS-A-MEMBER ON PURPOSE: a `removed` member keeps her role's read
   * scope (module doc). The role arms below already do all the narrowing that
   * needs doing — a removed nanny lands on the `own` arm exactly like an
   * active one, so she can never reach carer-2's rows.
   *
   * A `candidate` is refused here from 3-O, and by the LOOKUP rather than
   * by an arm below: `findMembershipAnyStatus` filters positively to
   * `{active, removed}`, so a nanny whose terms nobody has agreed yet
   * reads null and lands on the same opaque 404 a stranger gets. She has
   * no money trail here to keep (D-49).
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
      throw new ExpenseNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }
    if (EXPENSE_READ_ROLES.has(membership.role)) {
      return { kind: 'household' };
    }
    // The only non-parent arm: a nanny reading her OWN claims. A helper
    // never reaches it (she has no pay surface at all — CX spec).
    if (membership.role === HOUSEHOLD_ROLES.NANNY) {
      return { kind: 'own', carerId: callerId };
    }
    throw new ExpenseNotFoundError(householdId, {
      reason: 'expenses_not_visible_to_role',
    });
  }

  /** Narrow a household-scoped result set to one carer's rows when the scope says so. */
  private scopeRows(rows: Expense[], scope: ReadScope): Expense[] {
    if (scope.kind === 'household') {
      return rows;
    }
    return rows.filter(row => row.carer_id === scope.carerId);
  }
}

// Singleton for controllers/routes that don't need DI.
export const expenseQueryService = new ExpenseQueryService();

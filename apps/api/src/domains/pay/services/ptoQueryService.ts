/**
 * PTO query service (CQRS-lite: reads).
 *
 * READ GATING mirrors `payArrangementQueryService.assertCanReadPay` EXACTLY
 * — that method is private, so this is a deliberate MIRROR, not an import,
 * matching migration 043's RLS section which reproduces 041's select policy
 * character-for-character:
 *
 * | caller                                   | allowed |
 * |------------------------------------------|---------|
 * | active `owner`/`parent` of the household | yes     |
 * | the carer herself (`callerId === carerId`, active `nanny`) | yes |
 * | another `nanny` of the same household    | no      |
 * | `helper`                                 | no      |
 * | non-member                                | no      |
 *
 * Every denial — and "no such household", "not your carer" — raises the SAME
 * `PtoNotFoundError`, so a caller learns nothing about carers who aren't
 * hers.
 *
 * LAZY ANNUAL GRANT — `balance` and `ledger` both perform a WRITE on a read,
 * DELIBERATELY (TIER0-PLAN.md Phase 3, migration 043's header "V1 GRANT
 * MODEL"): the first read of the CURRENT calendar year with no `accrual` row
 * yet for this (household, carer) inserts one, dated 1 Jan of that year, for
 * whatever `pay_arrangements.pto_entitlement_minutes_per_year` the EFFECTIVE
 * arrangement carries AT THE MOMENT OF THE GRANT — i.e. resolved against the
 * household-LOCAL "today".
 *
 * ONLY THE HOUSEHOLD-LOCAL CURRENT YEAR IS GRANTABLE (Phase 3/4 review,
 * SERIOUS 4). Any other year — a nanny booking January time off makes the
 * client read next year — is readable but mints nothing; see
 * `ensureYearGranted` for the full argument.
 *
 * Two v1 simplifications, both intentional (review finding 20):
 *   - no pro-rating for a carer who joins mid-year — she is lazily granted
 *     the FULL annual amount the first time her year is read;
 *   - a mid-year change to `pto_entitlement_minutes_per_year` does NOT
 *     retro-adjust a year's grant already made — the grant is frozen at
 *     grant time, correctable only by a new `adjustment` row, never by
 *     mutating the grant.
 * If the effective arrangement has NO entitlement set at all (or there is no
 * effective arrangement), NO accrual row is written and `entitlement_minutes`
 * reads `null` — never a silent zero grant (docs/11-MONEY.md §4's
 * no-arrangement-no-zero rule, applied here to PTO).
 *
 * The insert races the DB's `pto_ledger_one_accrual_per_year_idx` partial
 * unique index: a losing concurrent reader gets `PtoAccrualGrantRaceError`
 * (from `PtoLedgerRepository.create`), which is caught here and turned into
 * a RE-READ of the winner's row rather than an error — see
 * `ensureYearGranted`.
 *
 * @module domains/pay/services/ptoQueryService
 */
import type {
  PtoBalance,
  PtoLedgerEntry,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import { localDateOf } from '../../timesheet/utils/weekStart';
import {
  PtoAccrualGrantRaceError,
  PtoNotFoundError,
} from '../errors/payErrors';
import { PayArrangementRepository } from '../repositories/payArrangementRepository';
import { PtoLedgerRepository } from '../repositories/ptoLedgerRepository';
import type { PayArrangement } from '../types';

/** Roles that may read ANY carer's PTO in the household — same set as pay. */
const PTO_READ_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/** A ledger row moves the balance up (accrual, or a positive adjustment). */
function isCredit(row: PtoLedgerEntry): boolean {
  return row.minutes > 0;
}

export class PtoQueryService {
  constructor(
    private readonly ptoRepo: PtoLedgerRepository = new PtoLedgerRepository(),
    private readonly payRepo: PayArrangementRepository = new PayArrangementRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository()
  ) {}

  /**
   * Entitlement/accrued/used/balance minutes for one carer's calendar year.
   * `entitlement_minutes` reflects the arrangement effective NOW (today), so
   * it can legitimately differ from `accrued_minutes` (what was actually
   * granted, frozen at grant time) after a mid-year rate change — that
   * divergence is intentional, not a bug (see the module doc).
   *
   * `now` is injectable purely for deterministic tests of the household-local
   * "today" boundary the lazy grant resolves against — production callers
   * never pass it (same convention as `payArrangementQueryService.getCurrent`).
   */
  async balance(
    callerId: string,
    householdId: string,
    carerId: string,
    year: number,
    now: () => Date = () => new Date()
  ): Promise<PtoBalance> {
    await this.assertCanReadPto(callerId, householdId, carerId);
    const { arrangement, today } = await this.effectiveArrangementToday(
      householdId,
      carerId,
      now
    );
    await this.ensureYearGranted(
      householdId,
      carerId,
      year,
      arrangement,
      today
    );
    const rows = await this.ptoRepo.listForCarerYear(
      householdId,
      carerId,
      year
    );

    return {
      carer_id: carerId,
      household_id: householdId,
      year,
      entitlement_minutes:
        arrangement?.pto_entitlement_minutes_per_year ?? null,
      accrued_minutes: sumCredits(rows),
      used_minutes: sumDebits(rows),
      balance_minutes: rows.reduce((total, row) => total + row.minutes, 0),
    };
  }

  /**
   * The ledger rows for one carer's calendar year, oldest first — the audit
   * trail behind `balance`'s numbers. Performs the SAME lazy grant as
   * `balance` (whichever of the two endpoints a client reads first triggers
   * it), so the two are always consistent with each other.
   */
  async ledger(
    callerId: string,
    householdId: string,
    carerId: string,
    year: number,
    now: () => Date = () => new Date()
  ): Promise<PtoLedgerEntry[]> {
    await this.assertCanReadPto(callerId, householdId, carerId);
    const { arrangement, today } = await this.effectiveArrangementToday(
      householdId,
      carerId,
      now
    );
    await this.ensureYearGranted(
      householdId,
      carerId,
      year,
      arrangement,
      today
    );
    return this.ptoRepo.listForCarerYear(householdId, carerId, year);
  }

  /**
   * The arrangement effective on the household-LOCAL today, plus that local
   * date itself — both derived from ONE household read, and both needed:
   * the arrangement sets the grant amount, the date sets which year is
   * grantable at all.
   */
  private async effectiveArrangementToday(
    householdId: string,
    carerId: string,
    now: () => Date
  ): Promise<{ arrangement: PayArrangement | null; today: string }> {
    const household = await this.householdRepo.findById(householdId);
    const today = localDateOf(now(), household?.timezone ?? 'UTC');
    return {
      arrangement: await this.payRepo.effectiveOn(householdId, carerId, today),
      today,
    };
  }

  /**
   * The lazy annual grant — see the module doc's "LAZY ANNUAL GRANT"
   * section for the full rule. Skips entirely (no read, no write) when the
   * effective arrangement sets no entitlement, so a carer with no PTO term
   * never accumulates a year's worth of empty accrual rows.
   *
   * ONLY THE HOUSEHOLD-LOCAL CURRENT YEAR IS GRANTABLE (Phase 3/4 review,
   * SERIOUS 4). `PtoYearQuerySchema` accepts any year from 2000 to 2100, and
   * this method used to grant WHATEVER year it was handed, at TODAY's
   * arrangement, frozen. A nanny booking January time off makes the client
   * read next year's balance, which minted next year's grant NOW at THIS
   * year's entitlement — a number that is wrong the moment her terms change
   * and, because the grant is frozen and the partial unique index makes it
   * un-re-grantable, correctable only by a hand-written adjustment row. Past
   * years are refused for the mirror reason: a year that was never granted
   * while it was current must not be back-filled today at terms that did not
   * exist then. Other years stay fully READABLE — they simply mint nothing,
   * and a client can tell the difference because `entitlement_minutes` still
   * reports while `accrued_minutes` reads zero.
   *
   * "Current" is the household's LOCAL year, from the same `localDateOf`
   * conversion `valid_from` validation uses: at 23:00 UTC on 31 December it
   * is already next year in Auckland, and granting the UTC year there would
   * be the same off-by-a-timezone bug in a costlier place.
   */
  private async ensureYearGranted(
    householdId: string,
    carerId: string,
    year: number,
    arrangement: PayArrangement | null,
    localToday: string
  ): Promise<void> {
    if (year !== Number(localToday.slice(0, 4))) {
      return;
    }
    if (!arrangement || arrangement.pto_entitlement_minutes_per_year === null) {
      return;
    }
    const entitlementMinutes = arrangement.pto_entitlement_minutes_per_year;

    const existing = await this.ptoRepo.listForCarerYear(
      householdId,
      carerId,
      year
    );
    if (existing.some(row => row.kind === 'accrual')) {
      return; // Already granted — the common case after the first read.
    }

    try {
      await this.ptoRepo.create({
        household_id: householdId,
        carer_id: carerId,
        kind: 'accrual',
        minutes: entitlementMinutes,
        effective_date: `${year}-01-01`,
        time_off_id: null,
        // The arrangement's own snapshot — reusing it keeps the name
        // consistent with the payroll record without a second profile
        // lookup; it is itself frozen at the arrangement's insert time, the
        // same snapshot discipline this row inherits.
        carer_display_name: arrangement.carer_display_name,
        note: `${year} annual PTO grant`,
        created_by: null,
      });
    } catch (err) {
      if (err instanceof PtoAccrualGrantRaceError) {
        // Lost the race: a concurrent reader's insert already won. The
        // winner's row is already in the table — the caller's subsequent
        // `listForCarerYear` re-read picks it up. Re-reading rather than
        // erroring is the documented behaviour (migration 043's header).
        return;
      }
      throw err;
    }
  }

  /**
   * The single read gate for this domain (see the module doc's table). Kept
   * private and called at the top of every method so no future read can
   * accidentally ship without it.
   */
  private async assertCanReadPto(
    callerId: string,
    householdId: string,
    carerId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      callerId
    );
    if (!membership) {
      throw new PtoNotFoundError(householdId, carerId, {
        reason: 'household_not_accessible',
      });
    }
    if (PTO_READ_ROLES.has(membership.role)) {
      return;
    }
    if (callerId === carerId && membership.role === HOUSEHOLD_ROLES.NANNY) {
      return;
    }
    throw new PtoNotFoundError(householdId, carerId, {
      reason: 'pto_not_visible_to_role',
    });
  }
}

/** Sum of every row that moves the balance UP (accrual + positive adjustment). */
function sumCredits(rows: PtoLedgerEntry[]): number {
  return rows.filter(isCredit).reduce((total, row) => total + row.minutes, 0);
}

/** Sum of the ABSOLUTE value of every row that moves the balance DOWN (usage + negative adjustment). */
function sumDebits(rows: PtoLedgerEntry[]): number {
  return rows
    .filter(row => !isCredit(row))
    .reduce((total, row) => total + Math.abs(row.minutes), 0);
}

// Singleton for controllers/routes that don't need DI.
export const ptoQueryService = new PtoQueryService();

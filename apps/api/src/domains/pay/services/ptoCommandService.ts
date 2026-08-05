/**
 * PTO command service (CQRS-lite: writes). Two independent operations that
 * both write to the append-only `pto_ledger` table (043's header) and
 * NEVER update or delete a row that already exists.
 *
 * THE NETTED TOTAL IS THE UNIT OF TRUTH IN BOTH (Phase 3/4 review, BLOCKERs
 * 1 and 3). What a household has paid for one time off is not "the usage
 * row" — it is `-sum(minutes)` over EVERY row it holds against that
 * `time_off_id`, usage and adjustments alike. Both methods below read that
 * total and write only the DIFFERENCE between it and the total they want.
 * That single rule is what makes them idempotent: re-running either against
 * a ledger already in the desired state computes a delta of zero and writes
 * nothing, which matters because both are reachable by retry (the mark-paid
 * tap, and the fire-and-forget reconciliation).
 *
 * 1. `markTimeOffPaid` — a parent states the TOTAL minutes this household
 *    pays for a confirmed time off. Three gates, in order, matching
 *    `payArrangementCommandService.create`'s shape:
 *      a. **Parent gate.** Only an active `owner`/`parent` may mark time off
 *         paid. A SINGLE parent suffices — no `approvalGateService` (owner
 *         decision 1, the same no-co-parent-approval rule Phase 1 set for
 *         pay terms, carried over here since PTO is pay-adjacent).
 *      b. **D12-class time-off assertion.** `time_off_id` arrives from the
 *         client — a client-supplied foreign id on a write, exactly the
 *         D12/D13/D14 shape. The time off must exist AND its `user_id` must
 *         be an ACTIVE member with role `nanny` OF THIS HOUSEHOLD. "No such
 *         time off" and "not your carer's time off" collapse into the SAME
 *         `PtoTimeOffNotFoundError` (docs/11-MONEY.md §9).
 *      c. **Status guard.** Only `status = 'confirmed'` time off is
 *         markable (TIER0-PLAN.md Phase 3, review finding 9) —
 *         `PtoTimeOffNotConfirmedError` for `requested`/`cancelled`.
 *    THE FIRST MARK WRITES A `usage` ROW; EVERY LATER ONE WRITES AN
 *    `adjustment` FOR THE DELTA (review BLOCKER 3). The mark-paid sheet
 *    always advertised that re-submitting appends a correction, and it
 *    never could: this method always inserted `kind='usage'`, so the
 *    `pto_ledger_one_usage_per_time_off_idx` partial unique index 409'd the
 *    second one and a parent who marked 8h and then realised it should be
 *    6h had NO way to correct it anywhere in the app. Now:
 *      - requested > netted → an `adjustment` of `-(delta)` (more paid);
 *      - requested < netted → an `adjustment` of `+(delta)` (paid back);
 *      - requested = netted → NO write at all, success returned (a retried
 *        tap is a no-op, not a 409);
 *      - requested = 0 → a full reversal of the netted total.
 *    Nothing is ever updated or deleted, so the ledger still reads as the
 *    complete history of what was decided and when.
 *
 *    `PtoAlreadyMarkedPaidError` remains reachable and is deliberately NOT
 *    caught: two parents tapping "mark paid" on an UNMARKED time off at the
 *    same instant both see no usage row and both insert one; the index is
 *    the source of truth under that race and the loser gets a clean typed
 *    409 instead of a second usage row. A sequential retry never reaches it
 *    — by then the first row is visible and the delta path takes over.
 *
 *    OVER-BALANCE IS DELIBERATELY ALLOWED, NEVER BLOCKED (review finding
 *    16, the CX spec's warn-never-block stance): minutes are the parent's
 *    free choice, with no read of the carer's current balance and no cap
 *    anywhere in this method. The mobile mark-paid sheet renders the
 *    warning; this service does not compute or enforce one.
 *
 *    THE CANCEL RACE (review SERIOUS 8): the status guard reads
 *    `carer_time_off` and the insert happens afterwards, so a cancel
 *    committing in between leaves a usage row on a cancelled time off that
 *    `reconcileCancelledTimeOff` has ALREADY run past — never reversed by
 *    anyone. The time off is therefore re-read AFTER the insert, and a
 *    marking that lost the race reverses itself (the same netted reversal
 *    reconcile uses) before refusing.
 *
 * 2. `reconcileCancelledTimeOff` — called (by the availability domain, NOT
 *    from within this domain — see its own doc) when a carer cancels time
 *    off that one or more households had already marked paid. Never
 *    mutates or deletes the original `usage` row; inserts a REVERSING
 *    `adjustment` row per affected household instead (append-only
 *    correction, same discipline as `pay_arrangements`'s "a change is a new
 *    row"). A shared time off can be marked paid by MULTIPLE households
 *    independently (a nanny with two families), so every one of them is
 *    reversed, not just the first found — and each household is reversed by
 *    its own NETTED outstanding total, so a household that was already
 *    reversed (or partly corrected) gets exactly the remainder, or nothing.
 *
 * @module domains/pay/services/ptoCommandService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  MarkTimeOffPaidRequest,
  PtoLedgerEntry,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
import { logger } from '../../../middlewares/logger';
import { CarerTimeOffRepository } from '../../availability/repositories/carerTimeOffRepository';
import type { CarerTimeOff } from '../../availability/types';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import { notifyHouseholdParents } from '../../notification/services/householdPush';
import type { PushPayload } from '../../notification/types';
import { localDateOf } from '../../timesheet/utils/weekStart';
import { UserService } from '../../user';
import {
  PtoNothingToAdjustError,
  PtoTimeOffNotConfirmedError,
  PtoTimeOffNotFoundError,
} from '../errors/payErrors';
import { PtoLedgerRepository } from '../repositories/ptoLedgerRepository';

/** Injectable push seam — defaults to the fire-and-forget household helper. */
export interface PtoPushNotifier {
  notifyHouseholdParents: (householdId: string, payload: PushPayload) => void;
}

/** Roles allowed to mark PTO paid — the household write roles, unchanged. */
const PTO_WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/** Only a CONFIRMED time off is markable (review finding 9). */
const MARKABLE_STATUS = 'confirmed';

/**
 * Fallback for `carer_display_name` when the member has no override and the
 * carer's profile has no `name` (both nullable). Same literal as
 * `payArrangementCommandService`'s, so an unnamed carer reads identically
 * across the payroll record.
 */
const UNNAMED_CARER_DISPLAY_NAME = 'Carer';

/**
 * Ledger `note` values are server-side English, like every other note this
 * domain writes (`ptoQueryService`'s "<year> annual PTO grant"). They are an
 * audit trail, not UI copy — nothing renders them through i18n today. If the
 * ledger history ever becomes a translated surface, these become keys.
 */
const CANCEL_REVERSAL_NOTE =
  'Reversed automatically — the carer cancelled this time off after it was marked paid';
const RACE_REVERSAL_NOTE =
  'Reversed automatically — the carer cancelled this time off while it was being marked paid';

/** Default note for a parent-initiated correction that carries no note. */
function correctionNote(fromMinutes: number, toMinutes: number): string {
  return `Adjusted paid time off from ${fromMinutes} to ${toMinutes} minutes`;
}

/** The signed sum of a set of ledger rows — the balance rule, in one place. */
function sumMinutes(rows: readonly PtoLedgerEntry[]): number {
  return rows.reduce((total, row) => total + row.minutes, 0);
}

export class PtoCommandService {
  constructor(
    private readonly ptoRepo: PtoLedgerRepository = new PtoLedgerRepository(),
    private readonly timeOffRepo: CarerTimeOffRepository = new CarerTimeOffRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    // Only `getProfileById` is needed, so tests can inject a lightweight stub
    // instead of the full static class (same seam as payArrangementCommandService).
    private readonly userService: Pick<
      typeof UserService,
      'getProfileById'
    > = UserService,
    private readonly push: PtoPushNotifier = { notifyHouseholdParents }
  ) {}

  /**
   * Set the TOTAL minutes this household pays for a confirmed time off,
   * appending whichever single row moves the ledger from its current netted
   * total to the requested one. Returns the row that now anchors that state
   * — the row just written, or (on a no-op re-submission) the existing
   * usage row. See the module doc for the gates, the delta rule, the
   * over-balance pinning and the cancel race.
   */
  async markTimeOffPaid(
    callerId: string,
    householdId: string,
    request: MarkTimeOffPaidRequest
  ): Promise<PtoLedgerEntry> {
    await this.assertPtoWriteRole(callerId, householdId);
    const { timeOff, membership } = await this.assertMarkableTimeOff(
      householdId,
      request.time_off_id
    );

    const existingRows = await this.ptoRepo.listForHouseholdTimeOff(
      householdId,
      timeOff.id
    );
    const usageRow = existingRows.find(row => row.kind === 'usage') ?? null;
    // What this household has actually paid so far, in POSITIVE minutes:
    // the ledger stores usage negative, and every correction against the
    // same time off moves that total (043's sign convention).
    const paidMinutes = -sumMinutes(existingRows);
    const requestedMinutes = Math.abs(request.minutes);
    const deltaMinutes = requestedMinutes - paidMinutes;

    if (deltaMinutes === 0) {
      if (usageRow) {
        // Already exactly this — a retried tap, not a correction. Nothing to
        // append (the ledger forbids zero-minute rows), so the caller gets
        // the row that already says so.
        return usageRow;
      }
      // Nothing marked and nothing asked for: there is no total to reverse
      // and no row to return. Refused with the same 400 the wire schema used
      // to give a zero-minute request.
      throw new PtoNothingToAdjustError(householdId, timeOff.id);
    }

    const created = usageRow
      ? // A marking already exists: append the DIFFERENCE as an adjustment,
        // dated with the usage row it corrects so it nets inside the same
        // week the engine prices, and carrying that row's name snapshot so
        // the correction reads identically to what it corrects.
        await this.ptoRepo.create({
          household_id: householdId,
          carer_id: usageRow.carer_id,
          kind: 'adjustment',
          minutes: -deltaMinutes,
          effective_date: usageRow.effective_date,
          time_off_id: usageRow.time_off_id,
          carer_display_name: usageRow.carer_display_name,
          note: request.note ?? correctionNote(paidMinutes, requestedMinutes),
          created_by: callerId,
        })
      : // Written field-by-field, never by spreading `request`: minutes is
        // negated here (the wire request is a positive count of minutes to
        // pay), and every other field is server-derived.
        await this.ptoRepo.create({
          household_id: householdId,
          carer_id: timeOff.user_id,
          kind: 'usage',
          minutes: -requestedMinutes,
          effective_date: await this.effectiveDateOf(householdId, timeOff),
          time_off_id: timeOff.id,
          carer_display_name: await this.resolveCarerDisplayName(
            timeOff.user_id,
            membership.display_name_override
          ),
          note: request.note ?? null,
          created_by: callerId,
        });

    await this.assertStillConfirmedAfterWrite(householdId, timeOff.id);
    return created;
  }

  /**
   * SERIOUS 8's guard: re-read the time off AFTER the write and undo it if a
   * cancel committed in between.
   *
   * A CONDITIONAL INSERT would be the textbook answer, and is not available
   * here: the condition lives in another domain's table (`carer_time_off`,
   * which carries no household reference at all, `011_availability.sql`), so
   * expressing it in SQL would mean a new RPC that reaches across that
   * boundary inside the database — a wider, less reviewable change than the
   * defect. The re-check costs one read, writes only append-only rows, and
   * heals the loser inside its own request instead of hoping a
   * fire-and-forget reconciliation that has ALREADY RUN somehow runs again.
   *
   * The compensation is `reverseNettedUsage`, the same netted reversal
   * reconcile uses, so a reconciliation racing this one cannot double-
   * reverse: whichever reads second sees the other's row and computes zero.
   */
  private async assertStillConfirmedAfterWrite(
    householdId: string,
    timeOffId: string
  ): Promise<void> {
    const current = await this.timeOffRepo.findById(timeOffId);
    if (current && current.status === MARKABLE_STATUS) {
      return;
    }
    await this.reverseNettedUsage(householdId, timeOffId, RACE_REVERSAL_NOTE);
    throw new PtoTimeOffNotConfirmedError(
      timeOffId,
      current?.status ?? 'missing'
    );
  }

  /** The household-local date a time off's leave starts on. */
  private async effectiveDateOf(
    householdId: string,
    timeOff: CarerTimeOff
  ): Promise<string> {
    const household = await this.householdRepo.findById(householdId);
    return localDateOf(
      new Date(timeOff.starts_at),
      household?.timezone ?? 'UTC'
    );
  }

  /**
   * Reverse every household's outstanding paid total for a time off that has
   * just been cancelled — see the module doc's point 2. Never throws on a
   * push failure (fire-and-forget, guarded per household). A DB failure on a
   * reversing insert does NOT stop the other households (they are separate
   * ledgers; see the loop) but is rethrown once every one has been
   * attempted, because that write IS the correction, not a decoration on
   * top of one, and the caller logs it.
   *
   * Exported for the availability domain's `timeOffCommandService.cancel`
   * to call — see that file's own integration note. This service does NOT
   * import the availability command service (that would be the wrong
   * direction of a cross-domain edge); the reverse import here
   * (`CarerTimeOffRepository`, read-only) is fine because it is a pure data
   * lookup, not a call into the other domain's write path.
   */
  async reconcileCancelledTimeOff(timeOffId: string): Promise<void> {
    const rows = await this.ptoRepo.listAllForTimeOff(timeOffId);
    const householdIds = [...new Set(rows.map(row => row.household_id))];

    // PER-HOUSEHOLD ISOLATION. Every household's reversal is independent —
    // they are separate ledgers that merely share a `time_off_id` — so one
    // failing must not strand the rest. Before this, the loop threw on the
    // first bad row and households later in the list were never reversed,
    // and could never BE reversed: the caller is fire-and-forget, there is
    // no retry, and the balance stayed silently wrong forever. Failures are
    // collected and rethrown AFTER every household has been attempted, so
    // the caller's log still records that something went wrong.
    const failures: unknown[] = [];
    for (const householdId of householdIds) {
      try {
        const reversed = await this.reverseNettedUsage(
          householdId,
          timeOffId,
          CANCEL_REVERSAL_NOTE,
          rows.filter(row => row.household_id === householdId)
        );
        if (reversed) {
          this.notifyReversal(householdId);
        }
      } catch (error) {
        failures.push(error);
        logger.error('Failed to reverse PTO usage for a household', {
          householdId,
          timeOffId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const firstFailure = failures[0];
    if (firstFailure !== undefined) {
      throw firstFailure;
    }
  }

  /**
   * Append the single `adjustment` row that takes ONE household's netted
   * total for a time off back to zero — the shared core of the cancel
   * reconciliation and the mark-paid race compensation.
   *
   * IDEMPOTENT BY CONSTRUCTION (review BLOCKER 1b), which is the whole
   * point. The amount written is not "the usage row's mirror" but "whatever
   * is still outstanding after every correction already recorded", so:
   * an un-reversed marking writes its full reversal; a partly-corrected one
   * writes only the remainder; an already-reversed one writes NOTHING and
   * returns false. Retrying is therefore free, which matters because the
   * only caller of the reconciliation path is fire-and-forget.
   *
   * WHY A READ-THEN-WRITE AND NOT A PARTIAL UNIQUE INDEX: a unique index on
   * `(household_id, time_off_id) where kind = 'adjustment'` would express
   * "at most one reversal" in the DB, the 039/043 pattern — and it would
   * directly contradict the adjust flow above, which needs UNLIMITED
   * adjustment rows against the same `(household, time_off)` so a parent can
   * correct 8h → 6h → 7h. The two requirements cannot both hold, and
   * correctability of a live pay figure beats a race window on a
   * compensating write. No new migration; nothing about 043 changes.
   *
   * `known` lets the caller pass rows it has already fetched (the
   * reconciliation reads every household in one query) instead of
   * re-reading per household.
   */
  private async reverseNettedUsage(
    householdId: string,
    timeOffId: string,
    note: string,
    known?: readonly PtoLedgerEntry[]
  ): Promise<boolean> {
    const rows =
      known ??
      (await this.ptoRepo.listForHouseholdTimeOff(householdId, timeOffId));
    const anchor = rows.find(row => row.kind === 'usage') ?? rows[0];
    if (!anchor) {
      return false;
    }
    const outstanding = sumMinutes(rows);
    if (outstanding === 0) {
      return false; // Already reversed (or corrected to nothing) — no-op.
    }

    await this.ptoRepo.create({
      household_id: householdId,
      carer_id: anchor.carer_id,
      kind: 'adjustment',
      // The exact mirror of what is STILL outstanding — the ledger nets
      // back to what it was before the paid marking, without ever touching
      // the original row.
      minutes: -outstanding,
      effective_date: anchor.effective_date,
      time_off_id: anchor.time_off_id,
      carer_display_name: anchor.carer_display_name,
      note,
      created_by: null,
    });
    return true;
  }

  /**
   * Fire-and-forget push to the household's parents — see the module doc.
   * `notifyHouseholdParents` (`householdPush.ts`) already swallows delivery
   * errors internally; the try/catch here is belt-and-braces against any
   * unexpected SYNCHRONOUS throw, matching
   * `payArrangementCommandService.notifyCarerOfNewTerms`'s identical guard.
   */
  private notifyReversal(householdId: string): void {
    try {
      this.push.notifyHouseholdParents(householdId, {
        title: 'A paid time off was cancelled',
        body: 'Your carer cancelled time off you had marked as paid — the balance has been corrected.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.PTO_USAGE_REVERSED,
          householdId,
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw.
    }
  }

  /** Gate 1 — see the module doc. */
  private async assertPtoWriteRole(
    callerId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      callerId
    );
    if (!membership || !PTO_WRITE_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(
        householdId,
        membership?.role ?? 'none'
      );
    }
  }

  /**
   * Gates 2 and 3 — the D12-class time-off assertion, then the status
   * guard. Returns both the time off row and the carer's membership row so
   * the caller can derive `effective_date` and the display-name snapshot
   * without a second membership lookup.
   */
  private async assertMarkableTimeOff(
    householdId: string,
    timeOffId: string
  ): Promise<{
    timeOff: CarerTimeOff;
    membership: { role: string; display_name_override: string | null };
  }> {
    const timeOff = await this.timeOffRepo.findById(timeOffId);
    if (!timeOff) {
      throw new PtoTimeOffNotFoundError(householdId, timeOffId, {
        reason: 'time_off_not_found',
      });
    }

    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      timeOff.user_id
    );
    if (!membership || membership.role !== HOUSEHOLD_ROLES.NANNY) {
      // SAME error as "no such time off" — a caller must not learn that a
      // real time-off id belongs to someone who isn't her carer.
      throw new PtoTimeOffNotFoundError(householdId, timeOffId, {
        reason: 'time_off_carer_not_active_nanny',
      });
    }

    if (timeOff.status !== MARKABLE_STATUS) {
      throw new PtoTimeOffNotConfirmedError(timeOff.id, timeOff.status);
    }

    return { timeOff, membership };
  }

  /**
   * Snapshot the carer's display name AT THIS INSTANT onto the new row —
   * same discipline and resolution order as
   * `payArrangementCommandService.resolveCarerDisplayName`: the household's
   * own `display_name_override` wins over the profile name, and a
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
export const ptoCommandService = new PtoCommandService();

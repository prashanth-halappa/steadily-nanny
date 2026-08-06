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
 * AND IT IS TRACKED PER DAY (review finding 15b). A marking is one ledger
 * row per household-local day the time off covers, not one row on its start
 * date: a fortnight marked 80h paid used to land all 4800 minutes in week
 * one, which priced an 80h PTO line and an inflated gross there, nothing in
 * week two, and froze that split the moment week one was approved
 * (`docs/11-MONEY.md` §3). So every read below is `paidMinutesByDate` and
 * every write is per-day — a correction moves each day, a reversal clears
 * each day, and the days always sum to the requested total exactly
 * (`allocateMinutes`). Migration 045 widened the usage index to
 * `(household_id, time_off_id, effective_date)` to allow it.
 *
 * LEDGER NOTES ARE STABLE MACHINE KEYS, NOT PROSE (review finding 16a):
 * every system-written `note` is a `PTO_LEDGER_NOTE_KEYS` value. The table
 * is append-only and permanent, so English written into it today could never
 * be re-keyed when the ledger history is localised — the mistake Wave 5's
 * handoff chips already paid for. A note the PARENT typed is user content
 * and is stored verbatim.
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
 *    A DAY'S FIRST MARK WRITES A `usage` ROW; EVERY LATER ONE WRITES AN
 *    `adjustment` ROW FOR THE DELTA (review BLOCKER 3). The mark-paid sheet
 *    always advertised that re-submitting appends a correction, and it
 *    never could: this method always inserted `kind='usage'`, so 043's
 *    per-time-off partial unique index 409'd the second one and a parent who
 *    marked 8h and then realised it should be 6h had NO way to correct it
 *    anywhere in the app. Now, per covered day:
 *      - requested > netted → an `adjustment` of `-(delta)` (more paid);
 *      - requested < netted → an `adjustment` of `+(delta)` (paid back);
 *      - requested = netted → NO write at all, success returned (a retried
 *        tap is a no-op, not a 409);
 *      - requested = 0 → a full reversal of the netted total.
 *    Nothing is ever updated or deleted, so the ledger still reads as the
 *    complete history of what was decided and when. ONE row still crosses
 *    the wire in the response (the earliest written) — see `anchorOf`.
 *
 *    `PtoAlreadyMarkedPaidError` is now a backstop rather than a live path.
 *    045's `(household_id, time_off_id, effective_date)` index still stands
 *    and `ptoLedgerRepository.create` still translates its 23505, but two
 *    simultaneous marks no longer reach it: they serialise on the lock, and
 *    the loser's compare-and-set fails, so it re-reads and appends its delta
 *    against what the winner wrote instead of colliding. The only remaining
 *    writer of `usage` rows through `create` is the lazy annual accrual
 *    grant, which the index does not cover.
 *
 *    OVER-BALANCE IS DELIBERATELY ALLOWED, NEVER BLOCKED (review finding
 *    16, the CX spec's warn-never-block stance): minutes are the parent's
 *    free choice, with no read of the carer's current balance and no cap
 *    anywhere in this method. The mobile mark-paid sheet renders the
 *    warning; this service does not compute or enforce one.
 *
 *    THE CANCEL RACE (review SERIOUS 8): the status guard reads
 *    `carer_time_off` and the insert used to happen afterwards, so a cancel
 *    committing in between left a usage row on a cancelled time off that
 *    `reconcileCancelledTimeOff` had ALREADY run past — never reversed by
 *    anyone. The status is now checked against the row migration 050 holds
 *    LOCKED, before anything is written, so the loser writes nothing rather
 *    than writing and compensating.
 *
 *    ONE LOCKED BATCH, NO BRANCH (F-B4-2). There is deliberately no
 *    "first marking or correction?" decision left in this file. There was,
 *    it was taken from an unlocked read, and that was the defect: two
 *    parents on a 5-day time off, A marking 480 and B marking 360, could
 *    disagree about which branch they were in — A inserted d1..d3 as
 *    separate statements, B read those three rows and legitimately corrected
 *    the whole span to 360, then A's loop resumed and added `usage` on d4
 *    and d5, which 045's index does not stop because it is partial on
 *    `kind = 'usage'` and B had written `adjustment` rows there. The ledger
 *    settled on 552 minutes and both parents were told they succeeded.
 *    Every write — marking, correction and reversal alike — is now one
 *    `applyPerDayTarget` call: one batch, one statement, inside migration
 *    050's `carer_time_off` row lock, with the per-day KIND decided from the
 *    same read the compare-and-set vouches for. A caller whose read went
 *    stale is refused and recomputes against what actually landed.
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
 *    its own NETTED outstanding total PER DAY, so a household that was
 *    already reversed (or partly corrected, or reversed for only some of a
 *    multi-day marking) gets exactly the remainder, or nothing.
 *
 * @module domains/pay/services/ptoCommandService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  MarkTimeOffPaidRequest,
  PtoLedgerEntry,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
import { PTO_LEDGER_NOTE_KEYS } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { ConflictError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { CarerTimeOffRepository } from '../../availability/repositories/carerTimeOffRepository';
import type { CarerTimeOff } from '../../availability/types';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import {
  notifyHouseholdParents,
  notifyUser,
} from '../../notification/services/householdPush';
import type { PushPayload } from '../../notification/types';
import { UserService } from '../../user';
import {
  PtoNothingToAdjustError,
  PtoTimeOffNotConfirmedError,
  PtoTimeOffNotFoundError,
} from '../errors/payErrors';
import { PtoLedgerRepository } from '../repositories/ptoLedgerRepository';
import { allocateMinutes } from '../utils/allocateMinutes';
import { localDatesCovered } from '../utils/localDateSpan';

/** Injectable push seam — defaults to the fire-and-forget household helper. */
export interface PtoPushNotifier {
  notifyHouseholdParents: (householdId: string, payload: PushPayload) => void;
  notifyUser: (userId: string, payload: PushPayload) => void;
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
 * How many times a correction re-reads and re-applies after losing
 * migration 050's compare-and-set. Two writers on one time off in one
 * household is already the rare case; three consecutive losses is not
 * something the app produces, so this is a bound on a pathology, not a
 * tuning knob.
 */
const MAX_CORRECTION_ATTEMPTS = 3;

/** The signed sum of a set of ledger rows — the balance rule, in one place. */
function sumMinutes(rows: readonly PtoLedgerEntry[]): number {
  return rows.reduce((total, row) => total + row.minutes, 0);
}

/**
 * What is currently PAID, per household-local day, for one time off:
 * `-sum(minutes)` of every row on that date. Positive means still paid,
 * zero means reversed (or never marked).
 *
 * Keyed by date rather than summed whole because a marking is one row per
 * covered day (review finding 15b) and those days can fall in different
 * timesheet weeks — the per-day figure is what the correction, the reversal
 * and the engine each have to be right about.
 */
function paidMinutesByDate(
  rows: readonly PtoLedgerEntry[]
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(
      row.effective_date,
      (byDate.get(row.effective_date) ?? 0) - row.minutes
    );
  }
  return byDate;
}

/** The row a new row on `date` should copy its snapshot fields from. */
function rowForDate(
  rows: readonly PtoLedgerEntry[],
  date: string
): PtoLedgerEntry | undefined {
  const onDate = rows.filter(row => row.effective_date === date);
  return onDate.find(row => row.kind === 'usage') ?? onDate[0];
}

/** The earliest-dated row, ties broken by insertion order. */
function earliestRow(
  rows: readonly PtoLedgerEntry[]
): PtoLedgerEntry | undefined {
  return rows.reduce<PtoLedgerEntry | undefined>(
    (earliest, row) =>
      !earliest || row.effective_date < earliest.effective_date
        ? row
        : earliest,
    undefined
  );
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
    private readonly push: PtoPushNotifier = {
      notifyHouseholdParents,
      notifyUser,
    }
  ) {}

  /**
   * Set the TOTAL minutes this household pays for a confirmed time off,
   * appending whichever rows move the ledger from its current per-day state
   * to the requested total. Returns the EARLIEST-dated row that now anchors
   * that state — the first row written, or (on a no-op re-submission) the
   * earliest existing usage row. See the module doc for the gates, the delta
   * rule, the over-balance pinning, the day spread and the cancel race.
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
    const coveredDates = await this.coveredDatesOf(householdId, timeOff);
    const requestedMinutes = Math.abs(request.minutes);
    const paidPerDay = paidMinutesByDate(existingRows);
    // What this household has actually paid so far, in POSITIVE minutes: the
    // ledger stores usage negative, and every correction against the same
    // time off moves that total (043's sign convention).
    const paidMinutes = -sumMinutes(existingRows);

    if (paidPerDay.size === 0 && requestedMinutes === 0) {
      // Nothing marked and nothing asked for: there is no total to reverse
      // and no row to return. Refused with the same 400 the wire schema
      // used to give a zero-minute request.
      throw new PtoNothingToAdjustError(householdId, timeOff.id);
    }

    if (requestedMinutes === paidMinutes) {
      // Already exactly this — a retried tap, not a correction. Nothing to
      // append (the ledger forbids zero-minute rows), so the caller gets the
      // earliest row that already says so.
      const anchor = earliestRow(
        existingRows.filter(row => row.kind === 'usage')
      );
      if (anchor) {
        return anchor;
      }
    }

    // The TARGET shape is the same whether this is the first marking or the
    // fifth correction: the requested total, spread evenly across the days
    // the time off covers TODAY. Weighting by what each day currently holds
    // was the obvious alternative and is wrong in the two cases that matter —
    // a retry after a partial write would top the one written day up to the
    // whole total (re-creating 15b), and a time off shortened after it was
    // marked would leave a paid day standing outside the leave. Re-spreading
    // converges to the documented rule from any starting state.
    //
    // Days the ledger touches but the leave no longer covers are NOT listed
    // here; `applyPerDayTarget` adds them with an implicit target of zero, so
    // they are reversed rather than orphaned.
    const targetPerDay = new Map<string, number>();
    const even = allocateMinutes(
      requestedMinutes,
      coveredDates.map(() => 1)
    );
    for (const [index, date] of coveredDates.entries()) {
      targetPerDay.set(date, even[index] ?? 0);
    }

    const written = await this.applyPerDayTarget({
      householdId,
      timeOffId: timeOff.id,
      targetPerDay,
      knownRows: existingRows,
      carer: {
        id: timeOff.user_id,
        displayName: await this.resolveCarerDisplayName(
          timeOff.user_id,
          membership.display_name_override
        ),
      },
      note: request.note ?? null,
      adjustmentNote: PTO_LEDGER_NOTE_KEYS.MARKED_PAID_ADJUSTED,
      createdBy: callerId,
      requireConfirmed: true,
    });
    this.notifyCarerMarkedPaid(householdId, timeOff.user_id);
    return this.anchorOf(written, householdId, timeOff.id);
  }

  /**
   * Move ONE household's ledger for ONE time off to an absolute per-day
   * target, in a single locked batch — the whole of a marking, a correction
   * (target = the requested total, spread) and a reversal (target = nothing,
   * so every day goes back to zero).
   *
   * SERIALISED, because the read and the write are otherwise a lost update
   * waiting to happen (F-B4-2). The deltas are computed HERE, from a read
   * that is not under any lock; `ptoRepo.applyCorrection` sends them together
   * with the per-day state they came from, and migration 050's function locks
   * the `carer_time_off` row, re-derives that state and refuses to write if
   * it moved. A refusal is not an error — it is "someone else wrote between
   * your read and your write": re-read, recompute against what they left, and
   * apply again, so the LAST writer's stated total wins instead of two
   * writers landing on a figure neither asked for.
   *
   * The arithmetic deliberately stays here rather than moving into plpgsql:
   * `allocateMinutes`, the covered-day span and the note keys are the money
   * rules, and they are testable in this shape and unreachable in the other.
   *
   * THE KIND IS DECIDED PER DAY, FROM THE SAME READ THE COMPARE-AND-SET
   * VALIDATES. A day with no `usage` row yet is being marked for the first
   * time and gets one; a day that already has one gets an `adjustment`. That
   * decision used to live one level up, as a branch over the whole request
   * taken from an unlocked read — which is what let two parents on a 5-day
   * time off disagree about which branch they were in and settle the ledger
   * on 552 minutes when one asked for 480 and the other for 360. Deciding it
   * here means the CAS vouches for it: if the ledger moved, the deltas AND
   * the kinds are recomputed together against what actually landed.
   *
   * A target of zero deltas skips the round trip entirely. Writing nothing is
   * always safe regardless of what else committed, and it is what keeps
   * re-submitting an unchanged total, and re-running an already-complete
   * reversal, true no-ops.
   */
  private async applyPerDayTarget(args: {
    householdId: string;
    timeOffId: string;
    targetPerDay: ReadonlyMap<string, number>;
    /** The caller's own read — used for the first attempt only. */
    knownRows: readonly PtoLedgerEntry[];
    /**
     * Who to name on a day that has no row yet. Absent on the reversal path,
     * which only ever touches days that already have one — and its absence is
     * also what keeps a reversal from ever writing a `usage` row.
     */
    carer?: { id: string; displayName: string };
    /** The PARENT's own note — user content, stored verbatim on a `usage` row. */
    note: string | null;
    /** The key an `adjustment` row carries when the parent typed nothing. */
    adjustmentNote: string;
    createdBy: string | null;
    requireConfirmed: boolean;
  }): Promise<PtoLedgerEntry[]> {
    let rows = args.knownRows;

    for (let attempt = 0; attempt < MAX_CORRECTION_ATTEMPTS; attempt += 1) {
      const paidPerDay = paidMinutesByDate(rows);
      const dates = [
        ...new Set([...args.targetPerDay.keys(), ...paidPerDay.keys()]),
      ].sort();

      const pending = dates.flatMap(date => {
        const delta =
          (args.targetPerDay.get(date) ?? 0) - (paidPerDay.get(date) ?? 0);
        if (delta === 0) {
          return [];
        }
        const anchor = rowForDate(rows, date);
        const firstMarkingOfDay = args.carer !== undefined && !anchor;
        return [
          {
            household_id: args.householdId,
            carer_id: anchor?.carer_id ?? args.carer?.id ?? null,
            kind: firstMarkingOfDay
              ? ('usage' as const)
              : ('adjustment' as const),
            // Ledger sign: paying MORE is more negative.
            minutes: -delta,
            // Dated with the day it corrects, so it nets inside the week that
            // day belongs to, and carrying that day's name snapshot so the
            // correction reads identically to what it corrects.
            effective_date: date,
            time_off_id: args.timeOffId,
            carer_display_name:
              anchor?.carer_display_name ??
              args.carer?.displayName ??
              UNNAMED_CARER_DISPLAY_NAME,
            note: firstMarkingOfDay
              ? args.note
              : (args.note ?? args.adjustmentNote),
            created_by: args.createdBy,
          },
        ];
      });

      if (pending.length === 0) {
        return [];
      }

      const written = await this.ptoRepo.applyCorrection({
        householdId: args.householdId,
        timeOffId: args.timeOffId,
        expected: Object.fromEntries(paidPerDay),
        rows: pending,
        requireConfirmed: args.requireConfirmed,
      });
      if (written) {
        return written;
      }

      // Lost the compare-and-set: re-read what the winner left behind.
      rows = await this.ptoRepo.listForHouseholdTimeOff(
        args.householdId,
        args.timeOffId
      );
    }

    // Sustained contention on ONE time off in ONE household is not a state
    // this app reaches honestly, so refusing beats looping: nothing has been
    // written, the ledger is exactly as the last winner left it, and the
    // client can simply try again.
    throw new ConflictError(
      'Another change to this time off got in first — please try again',
      'PTO_CORRECTION_RACE',
      { householdId: args.householdId, timeOffId: args.timeOffId }
    );
  }

  /** The household-local days a time off covers (`utils/localDateSpan.ts`). */
  private async coveredDatesOf(
    householdId: string,
    timeOff: CarerTimeOff
  ): Promise<string[]> {
    const household = await this.householdRepo.findById(householdId);
    return localDatesCovered(
      timeOff.starts_at,
      timeOff.ends_at,
      household?.timezone ?? 'UTC'
    );
  }

  /**
   * The row a multi-row write reports back. ONE `PtoLedgerEntry` still
   * crosses the wire (the response shape is `{ pto_ledger_entry }`, and a
   * client refetches the balance and ledger after the mutation anyway), so
   * the earliest-dated row written is the anchor — deterministic, and the
   * one a reader would name first. Falls back to a re-read only in the
   * degenerate case where a correction resolved to no rows at all.
   */
  private async anchorOf(
    written: readonly PtoLedgerEntry[],
    householdId: string,
    timeOffId: string
  ): Promise<PtoLedgerEntry> {
    const anchor = earliestRow(written);
    if (anchor) {
      return anchor;
    }
    const rows = await this.ptoRepo.listForHouseholdTimeOff(
      householdId,
      timeOffId
    );
    const existing = earliestRow(rows.filter(row => row.kind === 'usage'));
    if (!existing) {
      throw new PtoNothingToAdjustError(householdId, timeOffId);
    }
    return existing;
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
          PTO_LEDGER_NOTE_KEYS.CANCELLED_TIME_OFF_REVERSED,
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
   * correctability of a live pay figure beats a constraint on a compensating
   * write. The race window that reasoning accepted is now closed the other
   * way, by serialising the read-then-write itself
   * (`applyPerDayTarget`, migration 050) — 043's indexes are untouched.
   *
   * PER DAY, not per marking (review finding 15b): a multi-day marking is
   * several usage rows in (possibly) several weeks, and one lump reversal
   * dated on the first of them would zero week one's PTO line while leaving
   * week two's standing. Each day is taken back where it was given — an
   * empty target does exactly that, since every day the ledger touches is
   * then a day whose target is zero.
   *
   * NEVER `requireConfirmed`: this runs precisely BECAUSE the time off was
   * cancelled, so demanding a confirmed row would refuse every reversal it
   * exists to write.
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
    const written = await this.applyPerDayTarget({
      householdId,
      timeOffId,
      targetPerDay: new Map(),
      knownRows:
        known ??
        (await this.ptoRepo.listForHouseholdTimeOff(householdId, timeOffId)),
      // No `carer`: a reversal only ever touches days that already carry a
      // row, so it inherits their snapshot and can never write a `usage` row.
      note: null,
      adjustmentNote: note,
      createdBy: null,
      requireConfirmed: false,
    });
    return written.length > 0;
  }

  /**
   * Fire-and-forget push to the household's parents — see the module doc.
   * `notifyHouseholdParents` (`householdPush.ts`) already swallows delivery
   * errors internally; the try/catch here is belt-and-braces against any
   * unexpected SYNCHRONOUS throw, matching
   * `payArrangementCommandService.notifyCarerOfNewTerms`'s identical guard.
   */
  private notifyCarerMarkedPaid(householdId: string, carerId: string): void {
    try {
      this.push.notifyUser(carerId, {
        title: 'Time off marked paid',
        body: 'A parent marked your time off as paid.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.PTO_MARKED_PAID,
          householdId,
        },
      });
    } catch {
      // notifyUser is sync fire-and-forget; swallow any unexpected throw
    }
  }

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

/**
 * PTO command service (CQRS-lite: writes). Two independent operations that
 * both write to the append-only `pto_ledger` table (043's header) and
 * NEVER update or delete a row that already exists:
 *
 * 1. `markTimeOffPaid` — a parent turns a confirmed time off into a `usage`
 *    row (negative minutes). Three gates, in order, matching
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
 *    Duplicate marking is prevented by the DB's
 *    `pto_ledger_one_usage_per_time_off_idx` partial unique index, which
 *    `PtoLedgerRepository.create` translates into `PtoAlreadyMarkedPaidError`
 *    — this service does not catch it, so it propagates to the caller as a
 *    clean typed 409 rather than a raw 500.
 *
 *    OVER-BALANCE IS DELIBERATELY ALLOWED, NEVER BLOCKED (review finding
 *    16, the CX spec's warn-never-block stance): minutes are the parent's
 *    free choice, with no read of the carer's current balance and no cap
 *    anywhere in this method. The mobile mark-paid sheet renders the
 *    warning; this service does not compute or enforce one.
 *
 * 2. `reconcileCancelledTimeOff` — called (by the availability domain, NOT
 *    from within this domain — see its own doc) when a carer cancels time
 *    off that one or more households had already marked paid. Never
 *    mutates or deletes the original `usage` row; inserts a REVERSING
 *    `adjustment` row per affected household instead (append-only
 *    correction, same discipline as `pay_arrangements`'s "a change is a new
 *    row"). A shared time off can be marked paid by MULTIPLE households
 *    independently (a nanny with two families), so every one of them is
 *    reversed, not just the first found.
 *
 * @module domains/pay/services/ptoCommandService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  MarkTimeOffPaidRequest,
  PtoLedgerEntry,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
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
   * Turn a confirmed time off into a `usage` ledger row. Returns the created
   * row. See the module doc for the three gates and the over-balance
   * pinning.
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

    const household = await this.householdRepo.findById(householdId);
    const effectiveDate = localDateOf(
      new Date(timeOff.starts_at),
      household?.timezone ?? 'UTC'
    );
    const carerDisplayName = await this.resolveCarerDisplayName(
      timeOff.user_id,
      membership.display_name_override
    );

    // Written field-by-field, never by spreading `request`: minutes is
    // negated here (the wire request is a positive count of minutes to
    // pay), and every other field is server-derived.
    return this.ptoRepo.create({
      household_id: householdId,
      carer_id: timeOff.user_id,
      kind: 'usage',
      minutes: -Math.abs(request.minutes),
      effective_date: effectiveDate,
      time_off_id: timeOff.id,
      carer_display_name: carerDisplayName,
      note: request.note ?? null,
      created_by: callerId,
    });
  }

  /**
   * Reverse every household's `usage` row for a time off that has just been
   * cancelled — see the module doc's point 2. Never throws on a push
   * failure (fire-and-forget, guarded per household), but a DB failure on
   * the reversing insert itself propagates: that write IS the correction,
   * not a decoration on top of one.
   *
   * Exported for the availability domain's `timeOffCommandService.cancel`
   * to call — see that file's own integration note. This service does NOT
   * import the availability command service (that would be the wrong
   * direction of a cross-domain edge); the reverse import here
   * (`CarerTimeOffRepository`, read-only) is fine because it is a pure data
   * lookup, not a call into the other domain's write path.
   */
  async reconcileCancelledTimeOff(timeOffId: string): Promise<void> {
    const usageRows = await this.ptoRepo.findAllUsageForTimeOff(timeOffId);
    for (const usage of usageRows) {
      await this.ptoRepo.create({
        household_id: usage.household_id,
        carer_id: usage.carer_id,
        kind: 'adjustment',
        // The exact positive mirror of the usage row being reversed — the
        // ledger nets back to what it was before the paid marking, without
        // ever touching the original row.
        minutes: -usage.minutes,
        effective_date: usage.effective_date,
        time_off_id: usage.time_off_id,
        carer_display_name: usage.carer_display_name,
        note: 'Reversed automatically — the carer cancelled this time off after it was marked paid',
        created_by: null,
      });
      this.notifyReversal(usage.household_id);
    }
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

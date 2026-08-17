/**
 * Shift query service (CQRS-lite: reads only).
 *
 * THE READ GATE IS `assertShiftReader`, and it resolves a SCOPE from the
 * caller's ROLE, not merely a yes/no from her membership. Until migration 103
 * this was `assertMember`: any ACTIVE member of the household, any role, read
 * the whole calendar — so a SECOND NANNY read the first nanny's shifts, the
 * children on them, her change requests and the whole free-text day thread,
 * and a HELPER brought in for the school run read exactly the same. That is
 * the shape `087_payroll_read_scope.sql` removed from `timesheets` and
 * `time_entries`, and `103_shift_read_scope.sql` applies the same argument to
 * `shifts` in the same commit as this file. Owner/parent read household-wide;
 * a nanny reads only her OWN shifts; a helper reads nothing.
 *
 * THE `own` SCOPE IS FORCED, NEVER OFFERED. No read here takes a
 * client-supplied carer filter, and none ever should: the scope is derived
 * from the JWT's user id and applied row-wise below, the same enforcement
 * point `expenseQueryService.scopeRows` and `timesheetQueryService` use.
 *
 * THE DELIBERATE DIFFERENCE FROM `assertPayrollReader`. Payroll resolves on
 * membership of ANY status, because payroll is an audit trail — a nanny who
 * has left still reads the weeks she was owed for. The calendar is a LIVE
 * surface, not a record of settled money: a carer who is no longer in the
 * household has no shifts to turn up to, and showing her next week's plan
 * after she has been removed is a leak, not a courtesy. So this gate requires
 * an ACTIVE membership. Do not "harmonise" the two — the difference is the
 * decision.
 *
 * `getOwned` throws the SAME `ShiftNotFoundError(shiftId)` whether the shift
 * truly doesn't exist, its household isn't yours, or it is another carer's —
 * one constructor call for all three, so neither existence nor assignment
 * leaks.
 *
 * This domain only READS `shifts` (plus the writes in `shiftCommandService`)
 * — the `schedule` domain's `scheduleMaterialisationService`/
 * `scheduleShiftRepository` is the sole writer for pattern-driven
 * create/update/delete, so there is no overlap.
 *
 * NO WRITE FROM A READ (audit S14). `listDayThread` used to run uncovered-care
 * detection — a WRITE — before returning the thread. It no longer does.
 * Detection lives on the write paths that change cover, on
 * `scheduleHorizonJob.sweepUncoveredCare`, and on the hourly uncovered
 * digest; the explicit refresh a client can ask for is
 * `shiftCommandService.refreshDayThread` (POST, parent-only). See
 * `docs/12-NEED-COVERAGE.md`.
 *
 * @module domains/shift/services/shiftQueryService
 */
import {
  HOUSEHOLD_ROLES,
  PARENT_ROLES,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { HouseholdMemberRepository } from '../../household';
import { ShiftNotFoundError } from '../errors/shiftErrors';
import { ShiftEventRepository } from '../repositories/shiftEventRepository';
import {
  ShiftRepository,
  type ShiftWithChildren,
} from '../repositories/shiftRepository';
import type { ShiftEvent } from '../types';

/**
 * What `assertShiftReader` resolved: every carer's rows, or one carer's. Same
 * shape and same purpose as `timesheetQueryService`'s `PayrollReadScope` and
 * `expenseQueryService`'s `ReadScope`.
 */
export type ShiftReadScope =
  | { kind: 'household' }
  | { kind: 'own'; carerId: string };

/** The roles that read the household's whole calendar — one definition, drawn from the role map. */
const SHIFT_HOUSEHOLD_READ_ROLES: ReadonlySet<string> = PARENT_ROLES;

export class ShiftQueryService {
  constructor(
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly eventRepo: ShiftEventRepository = new ShiftEventRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /**
   * The primary calendar feed: shifts overlapping `[from, to)`, each with
   * its children (no N+1 — see `ShiftRepository.findByHouseholdAndRange`).
   * Narrowed to the caller's own shifts when she is a carer.
   */
  async listForHousehold(
    userId: string,
    householdId: string,
    from: string,
    to: string
  ): Promise<ShiftWithChildren[]> {
    const scope = await this.assertShiftReader(userId, householdId);
    const shifts = await this.shiftRepo.findByHouseholdAndRange(
      householdId,
      from,
      to
    );
    return this.scopeShifts(shifts, scope);
  }

  /**
   * Fetch one shift with its children, enforcing the read scope. Throws
   * ShiftNotFoundError for "doesn't exist", "not your household" and
   * "another carer's" alike — this is the `lookup` the ownership middleware
   * calls on /shifts/:shiftId routes.
   */
  async getOwned(userId: string, shiftId: string): Promise<ShiftWithChildren> {
    const shift = await this.shiftRepo.findByIdWithChildren(shiftId);
    if (!shift) {
      throw new ShiftNotFoundError(shiftId);
    }
    const scope = await this.resolveShiftReader(userId, shift.household_id);
    if (!scope || (scope.kind === 'own' && shift.carer_id !== scope.carerId)) {
      // The SAME call as the missing-row throw above, deliberately.
      throw new ShiftNotFoundError(shiftId);
    }
    return shift;
  }

  /**
   * The append-only day thread for one shift. Gated through `getOwned`, so a
   * carer cannot read the thread of a shift she could not read.
   */
  async listEvents(
    userId: string,
    householdId: string,
    shiftId: string
  ): Promise<ShiftEvent[]> {
    const shift = await this.getOwned(userId, shiftId);
    if (shift.household_id !== householdId) {
      throw new ShiftNotFoundError(shiftId);
    }
    return this.eventRepo.listForShift(householdId, shiftId);
  }

  /**
   * Household + local_date day thread (includes nullable-shift_id events).
   * Distinct from the shift-scoped `listEvents` route.
   *
   * A carer sees the rows SHE wrote plus every row on a shift of hers,
   * whoever wrote it. Day-level rows (`shift_id` null — `uncovered_care`,
   * `timesheet_reopened`) are parents-only: there is no shift to attach them
   * to a carer by, and both are household facts. Migration 103's
   * `shift_events` policy is the same three arms in SQL.
   */
  async listDayThread(
    userId: string,
    householdId: string,
    localDate: string
  ): Promise<ShiftEvent[]> {
    const scope = await this.assertShiftReader(userId, householdId);
    const events = await this.eventRepo.listForHouseholdDate(
      householdId,
      localDate
    );
    if (scope.kind === 'household') {
      return events;
    }
    const ownShiftIds = await this.ownShiftIdsAmong(events, scope.carerId);
    return events.filter(
      event =>
        event.actor_id === scope.carerId ||
        (event.shift_id !== null && ownShiftIds.has(event.shift_id))
    );
  }

  /**
   * The read gate shared across every household-scoped read above. Exposed
   * so a cross-domain read never invents a second gate — same precedent as
   * `timesheetQueryService.resolvePayrollReadScope`.
   */
  async resolveShiftReadScope(
    userId: string,
    householdId: string
  ): Promise<ShiftReadScope> {
    return this.assertShiftReader(userId, householdId);
  }

  /** Which of the shifts referenced by `events` belong to this carer — one round trip. */
  private async ownShiftIdsAmong(
    events: ShiftEvent[],
    carerId: string
  ): Promise<Set<string>> {
    const shiftIds = [
      ...new Set(
        events
          .map(event => event.shift_id)
          .filter((id): id is string => id !== null)
      ),
    ];
    const shifts = await this.shiftRepo.findByIds(shiftIds);
    return new Set(
      shifts.filter(shift => shift.carer_id === carerId).map(shift => shift.id)
    );
  }

  /** Apply an `own` scope row-wise. A household scope passes everything through. */
  private scopeShifts(
    shifts: ShiftWithChildren[],
    scope: ShiftReadScope
  ): ShiftWithChildren[] {
    if (scope.kind === 'household') {
      return shifts;
    }
    return shifts.filter(shift => shift.carer_id === scope.carerId);
  }

  /**
   * Resolve the caller's scope, or `null` when she has no shift surface at
   * all (not a member, removed, or a helper). Split from `assertShiftReader`
   * so `getOwned` can raise the shift-id form of the 404 rather than the
   * household-id form, without either path inventing a second role table.
   */
  private async resolveShiftReader(
    userId: string,
    householdId: string
  ): Promise<ShiftReadScope | null> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      userId
    );
    if (!membership) {
      return null;
    }
    if (SHIFT_HOUSEHOLD_READ_ROLES.has(membership.role)) {
      return { kind: 'household' };
    }
    if (membership.role === HOUSEHOLD_ROLES.NANNY) {
      return { kind: 'own', carerId: userId };
    }
    // A helper — no calendar surface, ever.
    return null;
  }

  private async assertShiftReader(
    userId: string,
    householdId: string
  ): Promise<ShiftReadScope> {
    const scope = await this.resolveShiftReader(userId, householdId);
    if (!scope) {
      throw new ShiftNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }
    return scope;
  }
}

// Singleton for controllers/routes that don't need DI.
export const shiftQueryService = new ShiftQueryService();

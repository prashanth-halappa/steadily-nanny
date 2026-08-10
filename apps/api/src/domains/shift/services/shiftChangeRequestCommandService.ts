/**
 * Shift-change-request command service (CQRS-lite: writes). Parents open
 * time-change/cancel/split/handover requests; nannies counter-offer. Short-
 * notice cancel/time-change consult the owner-only gate (flow 1f) before a
 * pending request is created. Accepting a request applies the mutation to the
 * shift and appends day-thread events.
 *
 * @module domains/shift/services/shiftChangeRequestCommandService
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type {
  Shift,
  ShiftChangeRequest,
  ShiftChild,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  SHIFT_CHANGE_REQUEST_KINDS,
  SHIFT_CHANGE_REQUEST_STATUSES,
  SHIFT_KINDS,
  SHIFT_ORIGINS,
  SHIFT_STATUSES,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ValidationError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { ChildNotFoundError } from '../../child/errors/childErrors';
import {
  type ChildQueryService,
  childQueryService,
} from '../../child/services/childQueryService';
import { detectUncoveredCareForDate } from '../../child/services/detectUncoveredCareForDate';
import type { Household, HouseholdMember } from '../../household';
import {
  type ApprovalGateAction,
  type ApprovalGateService,
  approvalGateService,
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import { notifyHouseholdParents, notifyUser } from '../../notification';
import { PayArrangementRepository } from '../../pay/repositories/payArrangementRepository';
// Dependency-free leaf (no timesheet-domain load-time coupling) — the same
// direct import `payArrangementCommandService` uses for the same reason.
import { localDateOf } from '../../timesheet/utils/weekStart';
import {
  ChangeRequestNotPendingError,
  ExtraShiftAlreadyExistsError,
  InvalidChangeRequestKindForRoleError,
  NotTheChangeRequestRequesterError,
  NotTheChangeRequestResponderError,
  ShiftNotFoundError,
} from '../errors/shiftErrors';
import {
  type AcceptShiftChangeRequestRpcArgs,
  ShiftChangeRequestRepository,
  type ShiftEventRpcInsert,
} from '../repositories/shiftChangeRequestRepository';
import { ShiftEventRepository } from '../repositories/shiftEventRepository';
import {
  ShiftRepository,
  type ShiftWithChildren,
} from '../repositories/shiftRepository';
import type {
  CreateExtraShiftInput,
  CreateShiftChangeRequestInput,
  RespondToShiftChangeRequestInput,
} from '../types';
import {
  type ShiftChangeRequestQueryService,
  shiftChangeRequestQueryService,
} from './shiftChangeRequestQueryService';
import { type ShiftQueryService, shiftQueryService } from './shiftQueryService';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);
const CARER_ROLES: ReadonlySet<string> = new Set([HOUSEHOLD_ROLES.NANNY]);

const PARENT_KINDS: ReadonlySet<string> = new Set([
  SHIFT_CHANGE_REQUEST_KINDS.TIME_CHANGE,
  SHIFT_CHANGE_REQUEST_KINDS.CANCEL,
]);

const TIME_KINDS: ReadonlySet<string> = new Set([
  SHIFT_CHANGE_REQUEST_KINDS.TIME_CHANGE,
  SHIFT_CHANGE_REQUEST_KINDS.COUNTER_OFFER,
]);

/**
 * Orchestrator seam for paid-cancel → timesheet entry. Defaults to a dynamic
 * import so this module does not create a load-time cycle with timesheet
 * (which already imports shift). Tests may replace it with a stub.
 */
export type CancellationPaidEntryRecorder = (shift: {
  id: string;
  household_id: string;
  carer_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  cancellation_paid: boolean;
}) => Promise<unknown>;

let cancellationPaidEntryRecorder: CancellationPaidEntryRecorder =
  async shift => {
    const { recordCancellationPaidEntry } = await import('../../timesheet');
    return recordCancellationPaidEntry(shift);
  };

/** Test / orchestrator override for the cancellation-pay recorder. */
export function setCancellationPaidEntryRecorder(
  recorder: CancellationPaidEntryRecorder
): void {
  cancellationPaidEntryRecorder = recorder;
}

export type CreateChangeRequestResult = {
  status: 'pending';
  shift_change_request: ShiftChangeRequest;
};

export type CreateExtraShiftResult = {
  status: 'created';
  shift: ShiftWithChildren;
  /**
   * True when this call did NOT write the shift — it found one already
   * matching the window and returned that instead (a double-tap). The wire
   * shape is identical either way, which is exactly why the flag has to be
   * explicit: the client cannot otherwise tell "I just booked this" from
   * "this was already booked", and neither can the push helper.
   */
  adopted: boolean;
};

/** What `insertExtraShift` answers with — see `CreateExtraShiftResult.adopted`. */
interface InsertedExtraShift {
  shift: ShiftWithChildren;
  adopted: boolean;
}

/** Hours from now until `startsAt` — negative if the shift already started. */
function hoursUntilStart(startsAt: string): number {
  return (new Date(startsAt).getTime() - Date.now()) / 3_600_000;
}

function isShortNotice(startsAt: string, shortNoticeHours: number): boolean {
  return hoursUntilStart(startsAt) < shortNoticeHours;
}

function isCancellationPaid(
  startsAt: string,
  cancellationPaidWithinHours: number
): boolean {
  return hoursUntilStart(startsAt) < cancellationPaidWithinHours;
}

/**
 * The three-arm cancellation-pay rule (owner decision 5, review finding 10).
 * `arrangement` is the carer's pay arrangement effective on the SHIFT's
 * household-local start date — never the accept date, never today, and never
 * the shift's own `local_date`, which migration 015 derives from the shift's
 * authoring timezone rather than the household's (see `respond`) — fetched
 * by the caller (`respond`) before `planAcceptedChange` runs, so this stays
 * pure and synchronous:
 *
 * 1. Arrangement exists, window is a number → that window governs, full stop
 *    (even if the household's own column would say otherwise).
 * 2. Arrangement exists, window is explicitly `null` → NOT paid. This is a
 *    deliberate no-cancellation-pay agreement, not the absence of one, and it
 *    overrides the household fallback even when the household's window would
 *    have covered this cancellation.
 * 3. No arrangement at all → fall back to `household.cancellation_paid_within_hours`
 *    (legacy behaviour, including its `0`-means-no-pay semantics — `0` is
 *    never greater than `hoursUntilStart`, so `isCancellationPaid` already
 *    resolves that case correctly without special-casing it here).
 */
function resolveCancellationPaid(
  startsAt: string,
  arrangement: PayArrangement | null,
  household: Household
): boolean {
  if (arrangement) {
    return (
      arrangement.cancellation_paid_within_hours !== null &&
      isCancellationPaid(startsAt, arrangement.cancellation_paid_within_hours)
    );
  }
  return isCancellationPaid(startsAt, household.cancellation_paid_within_hours);
}

/**
 * Pure planner: RPC args for accept + the day-thread events the RPC inserts in
 * the same transaction. The events carry no `local_date` — see
 * `ShiftEventRpcInsert` for why the day thread is the RPC's to resolve.
 *
 * `arrangement` has no default and is never optional: callers must be
 * explicit about arm 3 (no arrangement) by passing `null` rather than
 * omitting the argument — this is what a nanny gets paid, and a silently
 * `undefined` arrangement is not an acceptable way to reach the fallback.
 */
export function planAcceptedChange(
  userId: string,
  request: ShiftChangeRequest,
  shift: ShiftWithChildren,
  household: Household,
  arrangement: PayArrangement | null,
  responseMessage: string | null | undefined
): {
  rpcArgs: AcceptShiftChangeRequestRpcArgs;
  events: ShiftEventRpcInsert[];
} {
  const shortNotice = isShortNotice(
    shift.starts_at,
    household.short_notice_hours
  );
  const events: ShiftEventRpcInsert[] = [];

  const rpcArgs: AcceptShiftChangeRequestRpcArgs = {
    p_change_request_id: request.id,
    p_responded_by: userId,
    p_response_message: responseMessage ?? null,
    p_set_cancel: false,
    p_cancelled_at: null,
    p_cancelled_by: null,
    p_cancellation_paid: false,
    p_cancellation_message: null,
    p_set_times: false,
    p_starts_at: null,
    p_ends_at: null,
    p_origin: null,
    p_is_short_notice: shortNotice,
    p_events: [],
  };

  if (request.kind === SHIFT_CHANGE_REQUEST_KINDS.CANCEL) {
    const cancellationPaid = resolveCancellationPaid(
      shift.starts_at,
      arrangement,
      household
    );
    rpcArgs.p_set_cancel = true;
    rpcArgs.p_cancelled_at = new Date().toISOString();
    rpcArgs.p_cancelled_by = userId;
    rpcArgs.p_cancellation_paid = cancellationPaid;
    rpcArgs.p_cancellation_message = request.message;
    rpcArgs.p_origin = SHIFT_ORIGINS.PARENT_PROPOSED;
    events.push({
      household_id: shift.household_id,
      shift_id: shift.id,
      actor_id: userId,
      event_type: 'shift_cancelled',
      payload: {
        change_request_id: request.id,
        cancellation_paid: cancellationPaid,
        is_short_notice: shortNotice,
      },
    });
    return { rpcArgs, events };
  }

  if (TIME_KINDS.has(request.kind)) {
    if (!request.proposed_starts_at || !request.proposed_ends_at) {
      throw new ValidationError(
        'Accepted time change is missing proposed times',
        'MISSING_PROPOSED_TIMES',
        400,
        { changeRequestId: request.id }
      );
    }
    const origin =
      request.kind === SHIFT_CHANGE_REQUEST_KINDS.COUNTER_OFFER
        ? SHIFT_ORIGINS.NANNY_COUNTERED
        : SHIFT_ORIGINS.PARENT_PROPOSED;
    rpcArgs.p_set_times = true;
    rpcArgs.p_starts_at = request.proposed_starts_at;
    rpcArgs.p_ends_at = request.proposed_ends_at;
    rpcArgs.p_origin = origin;
    events.push({
      household_id: shift.household_id,
      shift_id: shift.id,
      actor_id: userId,
      event_type: 'shift_updated',
      payload: {
        change_request_id: request.id,
        before: {
          starts_at: shift.starts_at,
          ends_at: shift.ends_at,
        },
        after: {
          starts_at: request.proposed_starts_at,
          ends_at: request.proposed_ends_at,
        },
      },
    });
    return { rpcArgs, events };
  }

  // split / handover are rejected at CreateShiftChangeRequestSchema; this is
  // defence in depth if a historical row somehow reaches accept.
  throw new ValidationError(
    'This kind of change request is not supported',
    'UNSUPPORTED_CHANGE_REQUEST_KIND',
    400,
    { kind: request.kind, changeRequestId: request.id }
  );
}

export class ShiftChangeRequestCommandService {
  constructor(
    private readonly changeRequestRepo: ShiftChangeRequestRepository = new ShiftChangeRequestRepository(),
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly eventRepo: ShiftEventRepository = new ShiftEventRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly queries: ShiftChangeRequestQueryService = shiftChangeRequestQueryService,
    private readonly shiftQueries: ShiftQueryService = shiftQueryService,
    private readonly gate: ApprovalGateService = approvalGateService,
    private readonly children: ChildQueryService = childQueryService,
    private readonly payArrangementRepo: PayArrangementRepository = new PayArrangementRepository()
  ) {}

  /**
   * Open a change request against an existing shift. Parents may time-change,
   * cancel, split, or handover; nannies may counter-offer only. Short-notice
   * cancel/time-change consult the owner-only gate before creating the request.
   */
  async create(
    userId: string,
    shiftId: string,
    input: CreateShiftChangeRequestInput
  ): Promise<CreateChangeRequestResult> {
    const shift = await this.shiftQueries.getOwned(userId, shiftId);
    const membership = await this.requireMembership(userId, shift.household_id);
    this.assertKindAllowedForRole(input.kind, membership.role);

    // Refuse at OPEN time, not just on accept. A completed/cancelled shift —
    // or one with time entries behind it — is settled reality; letting a
    // request be raised against it only to 409 on accept wastes both sides'
    // time and leaves a misleading pending row in the day thread.
    await this.shiftRepo.assertMutable(shiftId);

    if (TIME_KINDS.has(input.kind)) {
      this.assertProposedTimes(input);
    }

    const household = await this.requireHousehold(shift.household_id);
    const shortNotice = isShortNotice(
      shift.starts_at,
      household.short_notice_hours
    );

    let coParentFyiAction: ApprovalGateAction | null = null;

    if (
      shortNotice &&
      (input.kind === SHIFT_CHANGE_REQUEST_KINDS.CANCEL ||
        input.kind === SHIFT_CHANGE_REQUEST_KINDS.TIME_CHANGE)
    ) {
      const action =
        input.kind === SHIFT_CHANGE_REQUEST_KINDS.CANCEL
          ? ('cancel' as const)
          : ('short_notice_change' as const);
      await this.gate.assertApprovalAllows(household, membership, action, {
        shift_id: shiftId,
        kind: input.kind,
        proposed_starts_at: input.proposed_starts_at ?? null,
        proposed_ends_at: input.proposed_ends_at ?? null,
        message: input.message ?? null,
      });
      coParentFyiAction = action;
    }

    const changeRequest = await this.openChangeRequest(shift, userId, input);
    if (coParentFyiAction) {
      void this.notifyCoParentActionFyi(
        userId,
        shift.household_id,
        shift,
        coParentFyiAction
      );
    }
    this.notifyChangeRequestOpened(shift, userId, changeRequest.id);
    return { status: 'pending', shift_change_request: changeRequest };
  }

  /**
   * Insert the pending request + its day-thread events. Shared by `create`
   * so the open path has one implementation.
   *
   * Every other still-pending request on the same shift is superseded first,
   * so the day thread never holds competing ask/answer pairs for one shift.
   *
   * The RPC writes `change_request_created` and `change_request_superseded`
   * itself (migration 030). Both name ids that do not exist until it runs —
   * the row it inserts, and the rows its CTE closed — and a second round-trip
   * from here would reopen the D23/D24 crash window: a failure between the
   * two writes would leave a change request with no audit trail. Nothing on
   * this path may call `eventRepo`.
   */
  private async openChangeRequest(
    shift: Shift,
    requestedBy: string,
    input: CreateShiftChangeRequestInput
  ): Promise<ShiftChangeRequest> {
    const { changeRequest } = await this.changeRequestRepo.openWithSupersede({
      p_shift_id: shift.id,
      p_requested_by: requestedBy,
      p_kind: input.kind,
      p_proposed_starts_at: input.proposed_starts_at ?? null,
      p_proposed_ends_at: input.proposed_ends_at ?? null,
      p_message: input.message ?? null,
    });

    return changeRequest;
  }

  /**
   * Parent proposes a one-off extra shift (flow 1d). Validates first, consults
   * the owner-only gate (`extra_shift`), then creates `kind=extra`,
   * `status=pending`, `origin=parent_proposed`.
   */
  async createExtraShift(
    userId: string,
    householdId: string,
    input: CreateExtraShiftInput
  ): Promise<CreateExtraShiftResult> {
    const membership = await this.assertExtraShiftAllowed(
      userId,
      householdId,
      input
    );
    const household = await this.requireHousehold(householdId);

    await this.gate.assertApprovalAllows(household, membership, 'extra_shift', {
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      timezone: input.timezone,
      carer_id: input.carer_id ?? null,
      child_ids: input.child_ids ?? null,
      note: input.note ?? null,
      reason: input.reason ?? null,
    });

    const { shift, adopted } = await this.insertExtraShift(
      userId,
      householdId,
      input
    );
    if (!adopted) {
      void this.notifyCoParentActionFyi(
        userId,
        householdId,
        shift,
        'extra_shift'
      );
      void this.notifyExtraShiftProposed(shift);
    }
    return { status: 'created', shift, adopted };
  }

  /**
   * Membership + carer + per-child ownership checks for an extra-shift proposal.
   */
  private async assertExtraShiftAllowed(
    userId: string,
    householdId: string,
    input: CreateExtraShiftInput
  ): Promise<HouseholdMember> {
    const membership = await this.requireParentMembership(userId, householdId);

    if (input.carer_id) {
      await this.assertCarerRole(householdId, input.carer_id);
    }

    if (input.child_ids?.length) {
      for (const childId of input.child_ids) {
        try {
          await this.children.getOwned(userId, householdId, childId);
        } catch (error) {
          if (error instanceof ChildNotFoundError) {
            throw new ValidationError(
              'One or more children do not belong to this household',
              'INVALID_SHIFT_CHILDREN',
              400,
              { householdId, childId }
            );
          }
          throw error;
        }
      }
    }

    return membership;
  }

  /**
   * Insert the pending extra shift + day-thread event.
   */
  private async insertExtraShift(
    createdBy: string,
    householdId: string,
    input: CreateExtraShiftInput
  ): Promise<InsertedExtraShift> {
    // These are four sequential writes and the shift row commits FIRST, so a
    // throw in any of the later three leaves the shift behind. Keyed on the
    // natural key so the `createExtraShift` double-tap is covered.
    const existing = await this.shiftRepo.findExtraShiftInWindow(
      householdId,
      input.carer_id ?? null,
      input.starts_at,
      input.ends_at
    );
    if (existing) {
      return { shift: existing, adopted: true };
    }

    let shift: Shift;
    try {
      shift = await this.shiftRepo.createShift({
        household_id: householdId,
        carer_id: input.carer_id ?? null,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        timezone: input.timezone,
        kind: SHIFT_KINDS.EXTRA,
        status: SHIFT_STATUSES.PENDING,
        origin: SHIFT_ORIGINS.PARENT_PROPOSED,
        note: input.note ?? null,
        reason: input.reason ?? null,
        created_by: createdBy,
      });
    } catch (error) {
      if (!(error instanceof ExtraShiftAlreadyExistsError)) {
        throw error;
      }
      // The pre-check above is check-then-act, so a SIMULTANEOUS create can
      // still slip between the read and the insert — a double-tapped button.
      // Migration 059's unique index catches that, and the answer the caller wants is
      // the shift that did get made, not a 409 for a booking that exists.
      // ponytail: if the winner is CANCELLED between the 23505 and this
      // re-read, the loser gets a 409 for a booking that could now legitimately
      // be made. Degrades safely (never a duplicate) and a retry succeeds;
      // upgrade path is a single retry loop if support tickets ever show it.
      const winner = await this.shiftRepo.findExtraShiftInWindow(
        householdId,
        input.carer_id ?? null,
        input.starts_at,
        input.ends_at
      );
      if (!winner) {
        // The index says it exists, the lookup says it does not. Adopting
        // nothing would return a shift nobody can see; surface the conflict.
        throw error;
      }
      // The children and the day-thread event belong to the winner's own call.
      // Re-writing them here would double the child rows and post the shift to
      // the thread twice.
      return { shift: winner, adopted: true };
    }

    if (input.child_ids?.length) {
      await this.shiftRepo.insertChildren(shift.id, input.child_ids);
    }

    await this.eventRepo.insertMany([
      {
        household_id: householdId,
        shift_id: shift.id,
        local_date: shift.local_date,
        actor_id: createdBy,
        event_type: 'extra_shift_proposed',
        payload: {
          shift_id: shift.id,
          reason: input.reason ?? null,
        },
      },
    ]);

    const withChildren = await this.shiftRepo.findByIdWithChildren(shift.id);
    return {
      shift: withChildren ?? { ...shift, shift_children: [] },
      adopted: false,
    };
  }

  /**
   * Accept or decline a pending change request. On accept, applies the
   * mutation to the shift (time change / cancel) and appends day-thread events.
   */
  async respond(
    userId: string,
    changeRequestId: string,
    input: RespondToShiftChangeRequestInput
  ): Promise<{ shift_change_request: ShiftChangeRequest; shift?: Shift }> {
    const request = await this.queries.getOwned(userId, changeRequestId);
    if (request.status !== SHIFT_CHANGE_REQUEST_STATUSES.PENDING) {
      throw new ChangeRequestNotPendingError(changeRequestId, request.status);
    }

    const shift = await this.shiftQueries.getOwned(userId, request.shift_id);
    const membership = await this.requireMembership(userId, shift.household_id);
    await this.assertCanRespond(userId, request, shift, membership);

    const events: Parameters<ShiftEventRepository['insertMany']>[0] = [];

    let updatedShift: Shift | undefined;
    let updatedRequest: ShiftChangeRequest;

    if (input.status === SHIFT_CHANGE_REQUEST_STATUSES.ACCEPTED) {
      // Re-check what `create` already checked (:330). The shift was mutable
      // when the request was OPENED; it need not still be when it is ANSWERED.
      // The chain that matters: parent opens a cancel at 07:00, the carer
      // clocks into the 08:00 shift, she accepts at 08:30 — the accept applies
      // to a shift being worked, and the paid-cancel entry lands on top of her
      // running one, after which no clock-out time is free of it.
      //
      // Deliberately inside the ACCEPT branch, not at the top of `respond`:
      // declining touches the request only, never the shift, so the carer
      // working the shift can always clear the pending row rather than being
      // stranded with a request she can neither accept nor dismiss.
      await this.shiftRepo.assertMutable(shift.id);

      const household = await this.requireHousehold(shift.household_id);
      // Only the cancel branch reads the arrangement, and it must be the one
      // effective on the SHIFT's household-local start date — not today, not
      // the accept date, since a rate/window change can land between the two
      // (owner decision 5, review finding 10). Skip the lookup for other
      // kinds and for an unassigned shift, where no arrangement can exist.
      //
      // "Household-local" is computed here rather than read off
      // `shift.local_date` (Phase 2 review, finding 8). That column is
      // derived by migration 015's `sync_shift_local_date` from the shift's
      // OWN `timezone` — the zone the shift was AUTHORED in, which 015 keeps
      // frozen on purpose so the original wall-clock intent survives the
      // household moving. Two supported actions make the two disagree:
      // `PATCH /households/:id { timezone }` (every already-materialised
      // shift keeps the old zone), and `POST .../shifts/extra`, whose
      // `timezone` is client-supplied and never checked against the
      // household's. Arrangements are household-scoped and every other date
      // in the pay domain is resolved with `localDateOf(instant,
      // household.timezone)` — `payArrangementCommandService`'s no-future
      // check and `weekEarningsService`'s closure days both — so this one
      // has to be too, or a cancellation gets priced against a day the
      // arrangement history was never keyed on.
      const arrangement =
        request.kind === SHIFT_CHANGE_REQUEST_KINDS.CANCEL && shift.carer_id
          ? await this.payArrangementRepo.effectiveOn(
              shift.household_id,
              shift.carer_id,
              localDateOf(new Date(shift.starts_at), household.timezone)
            )
          : null;
      const { rpcArgs, events: applyEvents } = planAcceptedChange(
        userId,
        request,
        shift,
        household,
        arrangement,
        input.message
      );
      const rpcEvents: ShiftEventRpcInsert[] = [
        {
          household_id: shift.household_id,
          shift_id: shift.id,
          actor_id: userId,
          event_type: 'change_request_accepted',
          payload: {
            change_request_id: changeRequestId,
            kind: request.kind,
            message: input.message ?? null,
          },
        },
        ...applyEvents,
      ];
      const applied = await this.changeRequestRepo.acceptAndApply({
        ...rpcArgs,
        p_events: rpcEvents,
      });
      updatedRequest = applied.changeRequest;
      // accept_shift_change_request returns the shift row only — no
      // shift_children join. Preserve the pre-fetch so accept paths stay
      // usable without a second round-trip.
      updatedShift = {
        ...applied.shift,
        shift_children: shift.shift_children,
      };

      if (request.kind === SHIFT_CHANGE_REQUEST_KINDS.CANCEL) {
        // Household parents get SHIFT_CANCELLED unless uncovered-care
        // detection already pushed for the gap (one parent push per event).
        let uncoveredInserted: Awaited<
          ReturnType<typeof detectUncoveredCareForDate>
        > = [];
        try {
          uncoveredInserted = await detectUncoveredCareForDate({
            householdId: shift.household_id,
            localDate: updatedShift.local_date,
            cause: 'cancelled',
            actorId: userId,
          });
        } catch (error) {
          logger.error('Uncovered-care detection failed after cancel accept', {
            shiftId: updatedShift.id,
            householdId: shift.household_id,
            localDate: updatedShift.local_date,
            error,
          });
        }
        if (uncoveredInserted.length === 0) {
          this.notifyShiftCancelled(shift, changeRequestId);
        }
        // Only a CARER requester gets the "your request was accepted" ping.
        // Parents already learn of the cancellation through the household
        // push above, so sending it to a parent requester notifies the same
        // person twice for one action. The carer's pay push below is a
        // different fact and goes out either way.
        if (request.requested_by === shift.carer_id) {
          this.notifyChangeRequestResponded(
            shift,
            request,
            PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED
          );
        }
        this.notifyCarerCancellationOutcome(
          updatedShift,
          applied.shift.cancellation_paid
        );
      } else {
        this.notifyChangeRequestResponded(
          shift,
          request,
          PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED
        );
      }

      if (
        request.kind === SHIFT_CHANGE_REQUEST_KINDS.CANCEL &&
        applied.shift.cancellation_paid
      ) {
        // ORCH: cancellation_paid entry — timesheet owns the write. The cancel
        // RPC has already committed `cancellation_paid = true`, so a swallowed
        // failure here returns 200 on a shift that is flagged as paid with no
        // `time_entries` row behind it: the carer is owed the hours, nothing is
        // user-visible, and no retry path exists. Silent underpay on a money
        // path — fail the request instead, and leave the flag standing as the
        // durable claim `cancellationPayReconcileJob` sweeps up and settles.
        // The repair is safe to re-run: since migration 053 a cancelled window
        // can pay out as several fragments, so idempotency is no longer a
        // find-first on `shift_id` — rows already written come back from
        // `recordCancellationPaidEntry`'s overlap query and are subtracted out
        // of the remainder, so a re-call writes only the genuinely missing
        // gaps. Clearing the flag would make the row
        // self-consistent by DELETING the only evidence she is owed anything —
        // and the sweep would then have nothing to find.
        //
        // Runs after the pushes on purpose: the cancellation itself is
        // committed and irreversible, so the household still has to hear about
        // it. The throw reports the missing pay entry, not a failed cancel.
        try {
          await cancellationPaidEntryRecorder(updatedShift);
        } catch (error) {
          logger.error('Failed to record cancellation_paid time entry', {
            shiftId: updatedShift.id,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
    } else {
      events.push({
        household_id: shift.household_id,
        shift_id: shift.id,
        local_date: shift.local_date,
        actor_id: userId,
        event_type: 'change_request_declined',
        payload: {
          change_request_id: changeRequestId,
          kind: request.kind,
          message: input.message ?? null,
        },
      });
      updatedRequest = await this.changeRequestRepo.respond(
        changeRequestId,
        input.status,
        userId,
        input.message
      );
      this.notifyChangeRequestResponded(
        shift,
        request,
        PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_DECLINED
      );
    }

    if (events.length > 0) {
      await this.eventRepo.insertMany(events);
    }
    return { shift_change_request: updatedRequest, shift: updatedShift };
  }

  /** pending -> withdrawn. Only the original requester may withdraw. */
  async withdraw(
    userId: string,
    changeRequestId: string
  ): Promise<ShiftChangeRequest> {
    const request = await this.queries.getOwned(userId, changeRequestId);
    if (request.status !== SHIFT_CHANGE_REQUEST_STATUSES.PENDING) {
      throw new ChangeRequestNotPendingError(changeRequestId, request.status);
    }
    if (request.requested_by !== userId) {
      throw new NotTheChangeRequestRequesterError(changeRequestId);
    }

    const shift = await this.shiftQueries.getOwned(userId, request.shift_id);
    const withdrawn = await this.changeRequestRepo.withdraw(changeRequestId);

    await this.eventRepo.insertMany([
      {
        household_id: shift.household_id,
        shift_id: shift.id,
        local_date: shift.local_date,
        actor_id: userId,
        event_type: 'change_request_withdrawn',
        payload: {
          change_request_id: changeRequestId,
          kind: request.kind,
        },
      },
    ]);

    this.notifyChangeRequestWithdrawn(shift, request, changeRequestId);

    return withdrawn;
  }

  private assertProposedTimes(input: CreateShiftChangeRequestInput): void {
    if (!input.proposed_starts_at || !input.proposed_ends_at) {
      throw new ValidationError(
        'proposed_starts_at and proposed_ends_at are required for this kind',
        'MISSING_PROPOSED_TIMES',
        400,
        { kind: input.kind }
      );
    }
  }

  private assertKindAllowedForRole(kind: string, role: string): void {
    if (PARENT_KINDS.has(kind)) {
      if (!WRITE_ROLES.has(role)) {
        throw new InvalidChangeRequestKindForRoleError(kind, role);
      }
      return;
    }
    if (kind === SHIFT_CHANGE_REQUEST_KINDS.COUNTER_OFFER) {
      if (!CARER_ROLES.has(role)) {
        throw new InvalidChangeRequestKindForRoleError(kind, role);
      }
      return;
    }
    throw new ValidationError(
      'Unknown change request kind',
      'INVALID_KIND',
      400,
      {
        kind,
      }
    );
  }

  private async assertCanRespond(
    userId: string,
    request: ShiftChangeRequest,
    shift: ShiftWithChildren,
    responderMembership: HouseholdMember
  ): Promise<void> {
    if (!request.requested_by) {
      throw new NotTheChangeRequestResponderError(request.id);
    }

    const requesterMembership = await this.memberRepo.findActiveMembership(
      shift.household_id,
      request.requested_by
    );
    if (!requesterMembership) {
      throw new NotTheChangeRequestResponderError(request.id);
    }

    const requesterIsParent = WRITE_ROLES.has(requesterMembership.role);
    const requesterIsNanny = CARER_ROLES.has(requesterMembership.role);

    if (requesterIsParent) {
      if (!CARER_ROLES.has(responderMembership.role)) {
        throw new NotTheChangeRequestResponderError(request.id);
      }
      // Identity, not just role — same shape as `shiftCommandService.accept`.
      // This used to read `shift.carer_id && shift.carer_id !== userId`, which
      // short-circuited on an UNASSIGNED shift and let ANY active nanny in the
      // household answer for it. An unassigned shift has no counterparty: no
      // one's consent is needed to change times nobody is working, and no one
      // is owed cancellation pay for a shift they were never assigned. So it
      // has no valid responder at all, exactly as `accept` already treats it.
      if (shift.carer_id !== userId) {
        throw new NotTheChangeRequestResponderError(request.id);
      }
      return;
    }

    if (requesterIsNanny) {
      if (!WRITE_ROLES.has(responderMembership.role)) {
        throw new NotTheChangeRequestResponderError(request.id);
      }
      return;
    }

    throw new NotTheChangeRequestResponderError(request.id);
  }

  private async requireMembership(
    userId: string,
    householdId: string
  ): Promise<HouseholdMember> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      userId
    );
    if (!membership) {
      throw new ShiftNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }
    return membership;
  }

  private async requireParentMembership(
    userId: string,
    householdId: string
  ): Promise<HouseholdMember> {
    const membership = await this.requireMembership(userId, householdId);
    this.assertWriteRole(householdId, membership);
    return membership;
  }

  private async requireHousehold(householdId: string): Promise<Household> {
    const household = await this.householdRepo.findById(householdId);
    if (!household) {
      throw new ShiftNotFoundError(householdId);
    }
    return household;
  }

  private assertWriteRole(
    householdId: string,
    membership: HouseholdMember
  ): void {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(householdId, membership.role);
    }
  }

  private async assertCarerRole(
    householdId: string,
    carerId: string
  ): Promise<void> {
    const carerMembership = await this.memberRepo.findActiveMembership(
      householdId,
      carerId
    );
    if (!carerMembership || !CARER_ROLES.has(carerMembership.role)) {
      throw new ValidationError(
        'carer_id must be an active nanny in this household',
        'INVALID_SHIFT_CARER',
        400,
        { householdId, carerId }
      );
    }
  }

  /** Fire-and-forget: ask the other side to look at a new change request. */
  private notifyChangeRequestOpened(
    shift: Shift,
    requestedBy: string,
    changeRequestId: string
  ): void {
    this.safeNotify(() => {
      const payload = {
        title: 'Schedule change requested',
        body: 'Someone asked to change a shift — open Schedule to respond.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED,
          shiftId: shift.id,
          changeRequestId,
          householdId: shift.household_id,
        },
      };
      if (requestedBy === shift.carer_id) {
        notifyHouseholdParents(shift.household_id, payload);
        return;
      }
      if (shift.carer_id) {
        notifyUser(shift.carer_id, payload);
      }
    });
  }

  /** Fire-and-forget: tell the requester the other side responded. */
  private notifyChangeRequestResponded(
    shift: Shift,
    request: ShiftChangeRequest,
    type:
      | typeof PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED
      | typeof PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_DECLINED
  ): void {
    this.safeNotify(() => {
      if (!request.requested_by) return;
      const accepted = type === PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED;
      notifyUser(request.requested_by, {
        title: accepted ? 'Change request accepted' : 'Change request declined',
        body: accepted
          ? 'Your schedule change was accepted.'
          : 'Your schedule change was declined.',
        data: {
          type,
          shiftId: shift.id,
          changeRequestId: request.id,
          householdId: shift.household_id,
        },
      });
    });
  }

  /** Fire-and-forget: tell the other side a pending request was withdrawn. */
  private notifyChangeRequestWithdrawn(
    shift: Shift,
    request: ShiftChangeRequest,
    changeRequestId: string
  ): void {
    this.safeNotify(() => {
      const payload = {
        title: 'Change request withdrawn',
        body: 'A pending schedule change was withdrawn.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_WITHDRAWN,
          shiftId: shift.id,
          changeRequestId,
          householdId: shift.household_id,
        },
      };
      if (request.requested_by === shift.carer_id) {
        notifyHouseholdParents(shift.household_id, payload);
        return;
      }
      if (shift.carer_id) {
        notifyUser(shift.carer_id, payload);
      }
    });
  }

  /** Fire-and-forget: household parents learn a shift was cancelled. */
  private notifyShiftCancelled(shift: Shift, changeRequestId: string): void {
    this.safeNotify(() => {
      notifyHouseholdParents(shift.household_id, {
        title: 'Shift cancelled',
        // Carries the day and hours for the same reason the decline push does:
        // a cancellation you can triage from the lock screen on Sunday is a
        // solvable problem; one you have to open the app to understand at 8:50
        // on Monday is a crisis.
        body: `${formatShiftWindow12h(
          shift.starts_at,
          shift.ends_at,
          shift.timezone
        )} was cancelled.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
          shiftId: shift.id,
          changeRequestId,
          householdId: shift.household_id,
        },
      });
    });
  }

  /** Fire-and-forget: assigned carer learns about a new extra shift. */
  private async notifyExtraShiftProposed(
    shift: ShiftWithChildren
  ): Promise<void> {
    try {
      if (!shift.carer_id) return;
      const actorId = shift.created_by ?? shift.carer_id;
      const parentName = shift.created_by
        ? await this.resolveParentDisplayName(
            shift.household_id,
            shift.created_by
          )
        : 'A parent';
      const childLabel = await this.resolveShiftChildrenLabel(
        actorId,
        shift.household_id,
        shift.shift_children
      );
      const whenLabel = formatShiftWindow24h(
        shift.starts_at,
        shift.ends_at,
        shift.timezone
      );
      const childSuffix = childLabel ? ` (${childLabel})` : '';
      const body = `${parentName} asked if you can cover ${whenLabel}${childSuffix}.`;
      const carerId = shift.carer_id;
      if (!carerId) return;
      this.safeNotify(() => {
        notifyUser(carerId, {
          title: 'Cover request',
          body,
          data: {
            type: PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED,
            shiftId: shift.id,
            householdId: shift.household_id,
          },
        });
      });
    } catch {
      // fire-and-forget
    }
  }

  /** Fire-and-forget: tell the assigned carer the cancellation pay outcome. */
  private notifyCarerCancellationOutcome(
    shift: Shift,
    cancellationPaid: boolean
  ): void {
    this.safeNotify(() => {
      if (!shift.carer_id) return;
      const windowLabel = formatShiftWindow12h(
        shift.starts_at,
        shift.ends_at,
        shift.timezone
      );
      const body = cancellationPaid
        ? `Your ${windowLabel} shift was cancelled. You'll still be paid for it.`
        : `Your ${windowLabel} shift was cancelled — that's ${shiftDurationLabel(
            shift.starts_at,
            shift.ends_at
          )} off this week's hours.`;
      notifyUser(shift.carer_id, {
        title: 'Shift cancelled',
        body,
        data: {
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
          shiftId: shift.id,
          householdId: shift.household_id,
        },
      });
    });
  }

  private async resolveShiftChildrenLabel(
    actorUserId: string,
    householdId: string,
    shiftChildren: ShiftChild[]
  ): Promise<string | null> {
    if (shiftChildren.length === 0) return null;
    const names: string[] = [];
    for (const row of shiftChildren) {
      try {
        const child = await this.children.getOwned(
          actorUserId,
          householdId,
          row.child_id
        );
        const name = child.name.trim();
        if (name) names.push(name);
      } catch {
        // omit unresolved children rather than blocking the push
      }
    }
    if (names.length === 0) return null;
    return names.join(', ');
  }

  /** Fire-and-forget: tell the other parent(s) a gated action already applied. */
  private async notifyCoParentActionFyi(
    actorUserId: string,
    householdId: string,
    shift: Pick<Shift, 'id' | 'local_date' | 'timezone' | 'household_id'>,
    action: ApprovalGateAction
  ): Promise<void> {
    try {
      const actorName = await this.resolveParentDisplayName(
        householdId,
        actorUserId
      );
      const shiftDay = formatShiftDayLabel(shift.local_date, shift.timezone);
      const { title, body } = coParentFyiCopy(actorName, action, shiftDay);
      this.safeNotify(() => {
        notifyHouseholdParents(
          householdId,
          {
            title,
            body,
            data: {
              type: PUSH_NOTIFICATION_TYPES.CO_PARENT_ACTION_FYI,
              shiftId: shift.id,
              householdId,
              action,
            },
          },
          { excludeUserId: actorUserId }
        );
      });
    } catch {
      // fire-and-forget
    }
  }

  private async resolveParentDisplayName(
    householdId: string,
    userId: string
  ): Promise<string> {
    const members = await this.memberRepo.listActiveByHousehold(householdId);
    const member = members.find(m => m.user_id === userId);
    if (!member) return 'A parent';
    const override = member.display_name_override?.trim();
    if (override) return override;
    const profileName = member.profile_name?.trim();
    if (profileName) return profileName;
    return 'A parent';
  }

  /** Push helpers must never fail the write that triggered them. */
  private safeNotify(fn: () => void): void {
    try {
      fn();
    } catch {
      // fire-and-forget
    }
  }
}

export const shiftChangeRequestCommandService =
  new ShiftChangeRequestCommandService();

/**
 * `8h`, `7h 30m`, `45m` — never rounded to whole hours.
 *
 * This lands in a message about her PAY. Rounding turned a 7h30m shift into
 * "8h off this week's hours" (overstating the loss) and a short shift into
 * "0h" (nonsense). On a money sentence, be exact or say nothing.
 */
function shiftDurationLabel(startsAt: string, endsAt: string): string {
  const totalMinutes = Math.max(
    0,
    Math.round(
      (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000
    )
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** `Thu 9 Aug, 09:00–11:20` in the shift's household timezone. */
function formatShiftWindow24h(
  startsAt: string,
  endsAt: string,
  timezone: string
): string {
  const dayLabel = formatShiftAskDateLabel(startsAt, timezone);
  const startTime = formatLocalTime24h(startsAt, timezone);
  const endTime = formatLocalTime24h(endsAt, timezone);
  return `${dayLabel}, ${startTime}–${endTime}`;
}

/** `9:00 AM – 5:00 PM` in the shift's household timezone. */
function formatShiftWindow12h(
  startsAt: string,
  endsAt: string,
  timezone: string
): string {
  const startTime = formatLocalTime12h(startsAt, timezone);
  const endTime = formatLocalTime12h(endsAt, timezone);
  return `${startTime} – ${endTime}`;
}

function formatShiftAskDateLabel(instantIso: string, timezone: string): string {
  const instant = new Date(instantIso);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: timezone,
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(instant);
  }
}

function formatLocalTime24h(instantIso: string, timezone: string): string {
  const instant = new Date(instantIso);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(instant);
  }
}

function formatLocalTime12h(instantIso: string, timezone: string): string {
  const instant = new Date(instantIso);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(instant);
  }
}

function formatShiftDayLabel(localDate: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      timeZone: timezone,
    }).format(new Date(`${localDate}T12:00:00`));
  } catch {
    return localDate;
  }
}

function coParentFyiCopy(
  actorName: string,
  action: ApprovalGateAction,
  shiftDay: string
): { title: string; body: string } {
  switch (action) {
    case 'cancel':
      return {
        title: 'Shift cancellation',
        body: `${actorName} cancelled ${shiftDay}'s shift.`,
      };
    case 'short_notice_change':
      return {
        title: 'Short-notice change',
        body: `${actorName} requested a short-notice change for ${shiftDay}'s shift.`,
      };
    case 'extra_shift':
      return {
        title: 'Extra shift proposed',
        body: `${actorName} proposed an extra shift.`,
      };
    default:
      return {
        title: 'Schedule update',
        body: `${actorName} made a schedule change.`,
      };
  }
}

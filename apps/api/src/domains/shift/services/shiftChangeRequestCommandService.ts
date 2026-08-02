/**
 * Shift-change-request command service (CQRS-lite: writes). Parents open
 * time-change/cancel/split/handover requests; nannies counter-offer. Short-
 * notice cancel/time-change may route through the co-parent approval gate
 * (flow 1f) before a pending request is created. Accepting a request applies
 * the mutation to the shift and appends day-thread events.
 *
 * @module domains/shift/services/shiftChangeRequestCommandService
 */
import type {
  Shift,
  ShiftChangeRequest,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  SHIFT_CHANGE_REQUEST_KINDS,
  SHIFT_CHANGE_REQUEST_STATUSES,
  SHIFT_KINDS,
  SHIFT_ORIGINS,
  SHIFT_STATUSES,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ValidationError } from '../../../errors';
import { ChildNotFoundError } from '../../child/errors/childErrors';
import {
  type ChildQueryService,
  childQueryService,
} from '../../child/services/childQueryService';
import type {
  CoParentApproval,
  Household,
  HouseholdMember,
} from '../../household';
import {
  type ApprovalGateService,
  approvalApplierRegistry,
  approvalGateService,
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import {
  ChangeRequestNotPendingError,
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
  SHIFT_CHANGE_REQUEST_KINDS.SPLIT,
  SHIFT_CHANGE_REQUEST_KINDS.HANDOVER,
]);

const TIME_KINDS: ReadonlySet<string> = new Set([
  SHIFT_CHANGE_REQUEST_KINDS.TIME_CHANGE,
  SHIFT_CHANGE_REQUEST_KINDS.COUNTER_OFFER,
]);

export type CreateChangeRequestResult =
  | { status: 'pending'; shift_change_request: ShiftChangeRequest }
  | { status: 'pending_approval'; approval: CoParentApproval };

export type CreateExtraShiftResult =
  | { status: 'created'; shift: ShiftWithChildren }
  | { status: 'pending_approval'; approval: CoParentApproval };

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
 * Pure planner: RPC args for accept + the day-thread events the RPC inserts in
 * the same transaction. The events carry no `local_date` — see
 * `ShiftEventRpcInsert` for why the day thread is the RPC's to resolve.
 */
export function planAcceptedChange(
  userId: string,
  request: ShiftChangeRequest,
  shift: ShiftWithChildren,
  household: Household,
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
    const cancellationPaid = isCancellationPaid(
      shift.starts_at,
      household.cancellation_paid_within_hours
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

  // split / handover — record acceptance only; detailed split logic is future work.
  return { rpcArgs, events };
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
    private readonly children: ChildQueryService = childQueryService
  ) {}

  /**
   * Open a change request against an existing shift. Parents may time-change,
   * cancel, split, or handover; nannies may counter-offer only. Short-notice
   * cancel/time-change may return `{ status: 'pending_approval' }` instead of
   * creating the request.
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

    if (
      shortNotice &&
      (input.kind === SHIFT_CHANGE_REQUEST_KINDS.CANCEL ||
        input.kind === SHIFT_CHANGE_REQUEST_KINDS.TIME_CHANGE)
    ) {
      const action =
        input.kind === SHIFT_CHANGE_REQUEST_KINDS.CANCEL
          ? ('cancel' as const)
          : ('short_notice_change' as const);
      const gateResult = await this.gate.assertApprovalAllows(
        household,
        membership,
        action,
        {
          shift_id: shiftId,
          kind: input.kind,
          proposed_starts_at: input.proposed_starts_at ?? null,
          proposed_ends_at: input.proposed_ends_at ?? null,
          message: input.message ?? null,
        }
      );
      if (gateResult.needsApproval) {
        return { status: 'pending_approval', approval: gateResult.approval };
      }
    }

    const changeRequest = await this.openChangeRequest(shift, userId, input);
    return { status: 'pending', shift_change_request: changeRequest };
  }

  /**
   * Insert the pending request + its day-thread events. Shared by `create`
   * (ungated path) and `applyApprovedChangeRequest` (the same work, resumed
   * once the co-parent signed off) so the two can never drift apart.
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
   * Applier for `cancel` / `short_notice_change` co-parent approvals (flow
   * 1f). `approvalGateService` stored the intended request on the approval
   * and returned `needsApproval`, so `create` never opened it; this re-drives
   * that step once the other parent approved — or once the timeout
   * auto-approved by silence.
   *
   * Note what this does NOT do: it opens the request against the shift, it
   * does not apply it to the shift. Co-parent sign-off unblocks ASKING the
   * nanny; the nanny still accepts or declines through the normal
   * `respond` path.
   *
   * `getOwned` is re-run as the ORIGINAL requester, so an approval that sat in
   * the queue while that parent left the household correctly fails to apply
   * rather than acting on their behalf after the fact.
   */
  async applyApprovedChangeRequest(
    approval: CoParentApproval
  ): Promise<ShiftChangeRequest> {
    const payload = approval.payload as {
      shift_id?: unknown;
      kind?: unknown;
      proposed_starts_at?: unknown;
      proposed_ends_at?: unknown;
      message?: unknown;
    };

    if (
      typeof payload.shift_id !== 'string' ||
      typeof payload.kind !== 'string'
    ) {
      throw new ValidationError(
        'Approval payload is missing the shift change it was gating',
        'INVALID_APPROVAL_PAYLOAD',
        400,
        { approvalId: approval.id }
      );
    }

    // `requested_by` is ON DELETE SET NULL — the requesting parent's profile
    // is gone, so there is no one to open the request on behalf of.
    const requestedBy = approval.requested_by;
    if (!requestedBy) {
      throw new ValidationError(
        'The parent who requested this approval no longer exists',
        'APPROVAL_REQUESTER_MISSING',
        400,
        { approvalId: approval.id }
      );
    }

    const shift = await this.shiftQueries.getOwned(
      requestedBy,
      payload.shift_id
    );

    await this.shiftRepo.assertMutable(payload.shift_id);

    return this.openChangeRequest(shift, requestedBy, {
      kind: payload.kind as CreateShiftChangeRequestInput['kind'],
      proposed_starts_at:
        typeof payload.proposed_starts_at === 'string'
          ? payload.proposed_starts_at
          : undefined,
      proposed_ends_at:
        typeof payload.proposed_ends_at === 'string'
          ? payload.proposed_ends_at
          : undefined,
      message:
        typeof payload.message === 'string' ? payload.message : undefined,
    });
  }

  /**
   * Parent proposes a one-off extra shift (flow 1d). Validates first, then
   * consults the co-parent approval gate (`extra_shift`). When the gate
   * parks the mutation, returns `{ status: 'pending_approval' }` without
   * writing a shift; otherwise creates `kind=extra`, `status=pending`,
   * `origin=parent_proposed`.
   */
  async createExtraShift(
    userId: string,
    householdId: string,
    input: CreateExtraShiftInput
  ): Promise<CreateExtraShiftResult> {
    // Validation BEFORE the gate — refuse a bad carer/child without parking
    // an approval that could never apply cleanly.
    const membership = await this.assertExtraShiftAllowed(
      userId,
      householdId,
      input
    );
    const household = await this.requireHousehold(householdId);

    const gateResult = await this.gate.assertApprovalAllows(
      household,
      membership,
      'extra_shift',
      {
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        timezone: input.timezone,
        carer_id: input.carer_id ?? null,
        child_ids: input.child_ids ?? null,
        note: input.note ?? null,
        reason: input.reason ?? null,
      }
    );
    if (gateResult.needsApproval) {
      return { status: 'pending_approval', approval: gateResult.approval };
    }

    const shift = await this.insertExtraShift(userId, householdId, input);
    return { status: 'created', shift };
  }

  /**
   * Membership + carer + per-child ownership checks for an extra-shift
   * proposal. Shared by `createExtraShift` (before the gate) and
   * `applyApprovedExtraShift` (re-run as the original requester).
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
   * Insert the pending extra shift + day-thread event. Shared by
   * `createExtraShift` (ungated path) and `applyApprovedExtraShift` so the
   * two can never drift apart.
   */
  private async insertExtraShift(
    createdBy: string,
    householdId: string,
    input: CreateExtraShiftInput
  ): Promise<ShiftWithChildren> {
    const shift = await this.shiftRepo.createShift({
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
    return withChildren ?? { ...shift, shift_children: [] };
  }

  /**
   * Applier for `extra_shift` co-parent approvals. Re-validates as the
   * ORIGINAL requester (so a departed carer/child or left household fails
   * loudly rather than inventing a shift) and then runs `insertExtraShift`.
   * Re-validation failure throws — it is not swallowed.
   */
  async applyApprovedExtraShift(
    approval: CoParentApproval
  ): Promise<ShiftWithChildren> {
    const payload = approval.payload as {
      starts_at?: unknown;
      ends_at?: unknown;
      timezone?: unknown;
      carer_id?: unknown;
      child_ids?: unknown;
      note?: unknown;
      reason?: unknown;
    };

    if (
      typeof payload.starts_at !== 'string' ||
      typeof payload.ends_at !== 'string' ||
      typeof payload.timezone !== 'string'
    ) {
      throw new ValidationError(
        'Approval payload is missing the extra shift it was gating',
        'INVALID_APPROVAL_PAYLOAD',
        400,
        { approvalId: approval.id }
      );
    }

    if (!(payload.ends_at > payload.starts_at)) {
      throw new ValidationError(
        'ends_at must be after starts_at',
        'INVALID_SHIFT_WINDOW',
        400,
        { approvalId: approval.id }
      );
    }

    const requestedBy = approval.requested_by;
    if (!requestedBy) {
      throw new ValidationError(
        'The parent who requested this approval no longer exists',
        'APPROVAL_REQUESTER_MISSING',
        400,
        { approvalId: approval.id }
      );
    }

    const input: CreateExtraShiftInput = {
      starts_at: payload.starts_at,
      ends_at: payload.ends_at,
      timezone: payload.timezone,
      ...(typeof payload.carer_id === 'string'
        ? { carer_id: payload.carer_id }
        : {}),
      ...(Array.isArray(payload.child_ids)
        ? {
            child_ids: payload.child_ids.filter(
              (id): id is string => typeof id === 'string'
            ),
          }
        : {}),
      ...(typeof payload.note === 'string' ? { note: payload.note } : {}),
      ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
    };

    await this.assertExtraShiftAllowed(
      requestedBy,
      approval.household_id,
      input
    );
    return this.insertExtraShift(requestedBy, approval.household_id, input);
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
      const household = await this.requireHousehold(shift.household_id);
      const { rpcArgs, events: applyEvents } = planAcceptedChange(
        userId,
        request,
        shift,
        household,
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
      // shift_children join. Preserve the pre-fetch so split/handover (and
      // other accept paths) stay usable without a second round-trip.
      updatedShift = {
        ...applied.shift,
        shift_children: shift.shift_children,
      };
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
      if (shift.carer_id && shift.carer_id !== userId) {
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
}

export const shiftChangeRequestCommandService =
  new ShiftChangeRequestCommandService();

/**
 * Close the flow-1f loop: `approvalGateService` (household domain) parks the
 * mutation, and these hand it back here once the other parent approves or the
 * timeout auto-approves. Registered at module load — `routes/index.ts` imports
 * the shift barrel at boot, so all three appliers exist before the first
 * request. The household domain cannot import this module directly without an
 * import cycle; see `approvalApplierRegistry` for why.
 */
approvalApplierRegistry.register('cancel', async approval => {
  await shiftChangeRequestCommandService.applyApprovedChangeRequest(approval);
});
approvalApplierRegistry.register('short_notice_change', async approval => {
  await shiftChangeRequestCommandService.applyApprovedChangeRequest(approval);
});
approvalApplierRegistry.register('extra_shift', async approval => {
  await shiftChangeRequestCommandService.applyApprovedExtraShift(approval);
});

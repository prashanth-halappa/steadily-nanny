/**
 * Shift-change-request repository — data access for `shift_change_requests`.
 * Uses the service-role Supabase client; membership/authorization lives in
 * the service layer.
 *
 * @module domains/shift/repositories/shiftChangeRequestRepository
 */
import type {
  Shift,
  ShiftChangeRequest,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_CHANGE_REQUEST_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import {
  ChangeRequestNotPendingError,
  ShiftImmutableError,
  ShiftNotFoundError,
} from '../errors/shiftErrors';

/**
 * One day-thread event handed to an RPC to insert inside its own transaction.
 *
 * Deliberately carries NO `local_date`: the RPC resolves the day thread from
 * the shift row it holds under lock, after any mutation. `shifts.local_date`
 * is maintained by the `sync_shifts_local_date` trigger (migration 015), so a
 * time change that crosses local midnight moves the shift to a new day — and
 * only the RPC can see the resulting date. Sending one from here would be a
 * value the database is obliged to ignore.
 */
export interface ShiftEventRpcInsert {
  household_id: string;
  shift_id: string;
  actor_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export interface AcceptShiftChangeRequestRpcArgs {
  p_change_request_id: string;
  p_responded_by: string;
  p_response_message: string | null;
  p_set_cancel: boolean;
  p_cancelled_at: string | null;
  p_cancelled_by: string | null;
  p_cancellation_paid: boolean;
  p_cancellation_message: string | null;
  p_set_times: boolean;
  p_starts_at: string | null;
  p_ends_at: string | null;
  p_origin: string | null;
  p_is_short_notice: boolean;
  p_events: ShiftEventRpcInsert[];
}

export interface OpenShiftChangeRequestRpcArgs {
  p_shift_id: string;
  p_requested_by: string;
  p_kind: ShiftChangeRequest['kind'];
  p_proposed_starts_at: string | null;
  p_proposed_ends_at: string | null;
  p_message: string | null;
}

type RpcOutcomePayload = {
  outcome: string;
  current_status?: string;
  shift_id?: string;
  shift_status?: string;
  blocked_by?: string;
  change_request?: ShiftChangeRequest;
  shift?: Shift;
  superseded?: ShiftChangeRequest[];
};

export class ShiftChangeRequestRepository extends BaseRepository<ShiftChangeRequest> {
  constructor() {
    super('shift_change_requests');
  }

  /** All change requests for one shift, newest first. */
  async listByShift(shiftId: string): Promise<ShiftChangeRequest[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list shift change requests',
        'DATABASE_ERROR',
        { details: error.message, shiftId }
      );
    }
    return (data ?? []) as ShiftChangeRequest[];
  }

  /**
   * Atomically accept a pending request, supersede siblings, and apply the
   * shift mutation — all under one shift-row lock (migration 024).
   */
  async acceptAndApply(args: AcceptShiftChangeRequestRpcArgs): Promise<{
    changeRequest: ShiftChangeRequest;
    shift: Shift;
    superseded: ShiftChangeRequest[];
  }> {
    const { data, error } = await supabaseService.rpc(
      'accept_shift_change_request',
      args
    );

    if (error) {
      throw new DatabaseError(
        'Failed to accept shift change request',
        'DATABASE_ERROR',
        { details: error.message, changeRequestId: args.p_change_request_id }
      );
    }

    const payload = data as RpcOutcomePayload;
    return this.handleAcceptOutcome(args.p_change_request_id, payload);
  }

  /**
   * Atomically supersede all pending requests on a shift and insert a new
   * pending one — under one shift-row lock (migration 024).
   */
  async openWithSupersede(args: OpenShiftChangeRequestRpcArgs): Promise<{
    changeRequest: ShiftChangeRequest;
    superseded: ShiftChangeRequest[];
  }> {
    const { data, error } = await supabaseService.rpc(
      'open_shift_change_request',
      args
    );

    if (error) {
      throw new DatabaseError(
        'Failed to open shift change request',
        'DATABASE_ERROR',
        { details: error.message, shiftId: args.p_shift_id }
      );
    }

    const payload = data as RpcOutcomePayload;
    if (payload.outcome === 'opened' && payload.change_request) {
      return {
        changeRequest: payload.change_request,
        superseded: payload.superseded ?? [],
      };
    }
    if (payload.outcome === 'shift_not_found') {
      throw new ShiftNotFoundError(args.p_shift_id);
    }
    if (payload.outcome === 'shift_immutable') {
      throw new ShiftImmutableError(
        payload.shift_id ?? args.p_shift_id,
        payload.shift_status ?? 'unknown',
        payload.blocked_by ?? 'status'
      );
    }

    throw new DatabaseError(
      'Unexpected outcome from open_shift_change_request',
      'DATABASE_ERROR',
      { outcome: payload.outcome, shiftId: args.p_shift_id }
    );
  }

  /**
   * Accept or decline a still-`pending` request (compare-and-set). Writes the
   * responder's text to `response_message` — never overwrites the requester's
   * `message` (migration 023). Used for decline-only; accept goes through
   * `acceptAndApply`.
   */
  async respond(
    changeRequestId: string,
    status: 'accepted' | 'declined',
    respondedBy: string,
    message?: string | null
  ): Promise<ShiftChangeRequest> {
    const patch: Record<string, unknown> = {
      status,
      responded_by: respondedBy,
      responded_at: new Date().toISOString(),
    };
    if (message !== undefined && message !== null) {
      patch.response_message = message;
    }

    const { data, error } = await supabaseService
      .from(this.table)
      .update(patch)
      .eq('id', changeRequestId)
      .eq('status', SHIFT_CHANGE_REQUEST_STATUSES.PENDING)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to respond to shift change request',
        'DATABASE_ERROR',
        { details: error.message, changeRequestId }
      );
    }
    if (!data) {
      throw new ChangeRequestNotPendingError(changeRequestId, 'unknown');
    }
    return data as ShiftChangeRequest;
  }

  /** pending -> withdrawn (compare-and-set). */
  async withdraw(changeRequestId: string): Promise<ShiftChangeRequest> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: SHIFT_CHANGE_REQUEST_STATUSES.WITHDRAWN })
      .eq('id', changeRequestId)
      .eq('status', SHIFT_CHANGE_REQUEST_STATUSES.PENDING)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to withdraw shift change request',
        'DATABASE_ERROR',
        { details: error.message, changeRequestId }
      );
    }
    if (!data) {
      throw new ChangeRequestNotPendingError(changeRequestId, 'unknown');
    }
    return data as ShiftChangeRequest;
  }

  private handleAcceptOutcome(
    changeRequestId: string,
    payload: RpcOutcomePayload
  ): {
    changeRequest: ShiftChangeRequest;
    shift: Shift;
    superseded: ShiftChangeRequest[];
  } {
    switch (payload.outcome) {
      case 'accepted':
        if (!payload.change_request || !payload.shift) {
          throw new DatabaseError(
            'accept_shift_change_request returned accepted without rows',
            'DATABASE_ERROR',
            { changeRequestId }
          );
        }
        return {
          changeRequest: payload.change_request,
          shift: payload.shift,
          superseded: payload.superseded ?? [],
        };
      case 'not_pending':
        throw new ChangeRequestNotPendingError(
          changeRequestId,
          payload.current_status ?? 'unknown'
        );
      case 'shift_immutable':
        throw new ShiftImmutableError(
          payload.shift_id ?? changeRequestId,
          payload.shift_status ?? 'unknown',
          payload.blocked_by ?? 'status'
        );
      case 'shift_not_found':
        throw new ShiftNotFoundError(payload.shift_id ?? changeRequestId);
      default:
        throw new DatabaseError(
          'Unexpected outcome from accept_shift_change_request',
          'DATABASE_ERROR',
          { outcome: payload.outcome, changeRequestId }
        );
    }
  }
}

/**
 * Shift-change-request repository — data access for `shift_change_requests`.
 * Uses the service-role Supabase client; membership/authorization lives in
 * the service layer.
 *
 * @module domains/shift/repositories/shiftChangeRequestRepository
 */
import type { ShiftChangeRequest } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_CHANGE_REQUEST_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { ChangeRequestNotPendingError } from '../errors/shiftErrors';

export interface NewShiftChangeRequestData {
  shift_id: string;
  requested_by: string;
  kind: ShiftChangeRequest['kind'];
  proposed_starts_at?: string | null;
  proposed_ends_at?: string | null;
  message?: string | null;
  status?: ShiftChangeRequest['status'];
}

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

  async createRequest(
    data: NewShiftChangeRequestData
  ): Promise<ShiftChangeRequest> {
    return this.create({
      ...data,
      status: data.status ?? 'pending',
      proposed_starts_at: data.proposed_starts_at ?? null,
      proposed_ends_at: data.proposed_ends_at ?? null,
      message: data.message ?? null,
    });
  }

  /**
   * Accept or decline a still-`pending` request (compare-and-set). Writes the
   * responder's text to `response_message` — never overwrites the requester's
   * `message` (migration 023).
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

  /**
   * Close every other still-`pending` change request on the same shift.
   * Does not set `responded_by` / `responded_at` — supersession is not a
   * human response. Returns the rows that were just closed.
   */
  async supersedePendingForShift(
    shiftId: string,
    exceptChangeRequestId: string
  ): Promise<ShiftChangeRequest[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: SHIFT_CHANGE_REQUEST_STATUSES.SUPERSEDED })
      .eq('shift_id', shiftId)
      .eq('status', SHIFT_CHANGE_REQUEST_STATUSES.PENDING)
      .neq('id', exceptChangeRequestId)
      .select();

    if (error) {
      throw new DatabaseError(
        'Failed to supersede pending shift change requests',
        'DATABASE_ERROR',
        { details: error.message, shiftId, exceptChangeRequestId }
      );
    }
    return (data ?? []) as ShiftChangeRequest[];
  }
}

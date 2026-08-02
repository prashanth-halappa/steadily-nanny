/**
 * Shift-change-request repository — data access for `shift_change_requests`.
 * Uses the service-role Supabase client; membership/authorization lives in
 * the service layer.
 *
 * @module domains/shift/repositories/shiftChangeRequestRepository
 */
import type { ShiftChangeRequest } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

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

  /** Accept or decline a pending request. */
  async respond(
    changeRequestId: string,
    status: 'accepted' | 'declined',
    respondedBy: string,
    message?: string | null
  ): Promise<ShiftChangeRequest> {
    const patch: Partial<ShiftChangeRequest> = {
      status,
      responded_by: respondedBy,
      responded_at: new Date().toISOString(),
    };
    if (message !== undefined && message !== null) {
      patch.message = message;
    }
    return this.update(changeRequestId, patch);
  }

  /** pending -> withdrawn. */
  async withdraw(changeRequestId: string): Promise<ShiftChangeRequest> {
    return this.update(changeRequestId, { status: 'withdrawn' });
  }
}

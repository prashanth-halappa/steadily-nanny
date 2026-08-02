import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  ShiftImmutableError,
  ShiftNotFoundError,
} from '../../../../../src/domains/shift/errors/shiftErrors';
import { DatabaseError } from '../../../../../src/errors';
import { MockSupabase } from '../../../../helpers/mockSupabase';

let ShiftChangeRequestRepository: any;
let mockSupabaseService: ReturnType<typeof MockSupabase.createMockClient>;

const acceptedRow = {
  id: 'cr1',
  shift_id: 's1',
  status: 'accepted',
  kind: 'cancel',
};

const shiftRow = {
  id: 's1',
  status: 'cancelled',
  sequence: 1,
};

beforeAll(async () => {
  mockSupabaseService = MockSupabase.createMockClient();
  mock.module('../../../../../src/config/supabase', () => ({
    supabase: mockSupabaseService,
    supabaseService: mockSupabaseService,
  }));

  const mod = await import(
    '../../../../../src/domains/shift/repositories/shiftChangeRequestRepository'
  );
  ShiftChangeRequestRepository = mod.ShiftChangeRequestRepository;
});

beforeEach(() => {
  mockSupabaseService.rpc.mockClear?.();
  mockSupabaseService.from.mockClear?.();
});

describe('ShiftChangeRequestRepository.acceptAndApply', () => {
  const rpcArgs = {
    p_change_request_id: 'cr1',
    p_responded_by: 'carer-1',
    p_response_message: 'ok',
    p_set_cancel: true,
    p_cancelled_at: '2026-08-03T10:00:00.000Z',
    p_cancelled_by: 'carer-1',
    p_cancellation_paid: false,
    p_cancellation_message: 'Cannot make it',
    p_set_times: false,
    p_starts_at: null,
    p_ends_at: null,
    p_origin: 'parent_proposed',
    p_is_short_notice: false,
    p_events: [],
  };

  it('calls accept_shift_change_request RPC with planned args', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse({
        outcome: 'accepted',
        change_request: acceptedRow,
        shift: shiftRow,
        superseded: [],
      })
    );
    const repo = new ShiftChangeRequestRepository();

    const result = await repo.acceptAndApply(rpcArgs);

    expect(mockSupabaseService.rpc).toHaveBeenCalledWith(
      'accept_shift_change_request',
      rpcArgs
    );
    expect(result.changeRequest).toEqual(acceptedRow as any);
    expect(result.shift).toEqual(shiftRow as any);
    expect(result.superseded).toEqual([]);
  });

  it('throws ChangeRequestNotPendingError with real current_status', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse({
        outcome: 'not_pending',
        current_status: 'declined',
      })
    );
    const repo = new ShiftChangeRequestRepository();
    await expect(repo.acceptAndApply(rpcArgs)).rejects.toMatchObject({
      name: 'ChangeRequestNotPendingError',
      metadata: { changeRequestId: 'cr1', status: 'declined' },
    });
  });

  it('throws ShiftImmutableError on shift_immutable outcome', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse({
        outcome: 'shift_immutable',
        shift_status: 'completed',
        blocked_by: 'status',
      })
    );
    const repo = new ShiftChangeRequestRepository();
    await expect(repo.acceptAndApply(rpcArgs)).rejects.toBeInstanceOf(
      ShiftImmutableError
    );
  });

  it('throws ShiftNotFoundError on shift_not_found outcome', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse({
        outcome: 'shift_not_found',
      })
    );
    const repo = new ShiftChangeRequestRepository();
    await expect(repo.acceptAndApply(rpcArgs)).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
  });

  it('throws DatabaseError on unknown outcome', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse({ outcome: 'wat' })
    );
    const repo = new ShiftChangeRequestRepository();
    await expect(repo.acceptAndApply(rpcArgs)).rejects.toBeInstanceOf(
      DatabaseError
    );
  });

  it('throws DatabaseError when RPC returns a PostgREST error', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createErrorResponse('boom')
    );
    const repo = new ShiftChangeRequestRepository();
    await expect(repo.acceptAndApply(rpcArgs)).rejects.toBeInstanceOf(
      DatabaseError
    );
  });
});

describe('ShiftChangeRequestRepository.openWithSupersede', () => {
  const openArgs = {
    p_shift_id: 's1',
    p_requested_by: 'parent-1',
    p_kind: 'cancel' as const,
    p_proposed_starts_at: null,
    p_proposed_ends_at: null,
    p_message: 'Emergency',
  };

  it('calls open_shift_change_request RPC and returns row + superseded siblings', async () => {
    const created = { id: 'cr-new', shift_id: 's1', status: 'pending' };
    const superseded = [{ id: 'cr-old', status: 'superseded' }];
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse({
        outcome: 'opened',
        change_request: created,
        superseded,
      })
    );
    const repo = new ShiftChangeRequestRepository();

    const result = await repo.openWithSupersede(openArgs);

    expect(mockSupabaseService.rpc).toHaveBeenCalledWith(
      'open_shift_change_request',
      openArgs
    );
    expect(result.changeRequest).toEqual(created as any);
    expect(result.superseded).toEqual(superseded as any);
  });

  it('throws ShiftImmutableError on shift_immutable outcome', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse({
        outcome: 'shift_immutable',
        shift_status: 'completed',
        blocked_by: 'status',
      })
    );
    const repo = new ShiftChangeRequestRepository();
    await expect(repo.openWithSupersede(openArgs)).rejects.toBeInstanceOf(
      ShiftImmutableError
    );
  });

  it('throws DatabaseError on unknown outcome', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse({ outcome: 'nope' })
    );
    const repo = new ShiftChangeRequestRepository();
    await expect(repo.openWithSupersede(openArgs)).rejects.toBeInstanceOf(
      DatabaseError
    );
  });
});

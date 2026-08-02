/**
 * ShiftRepository.applyParentEdit — the RPC wire contract for
 * `apply_parent_shift_edit`. Kept in its own file (rather than
 * `shiftRepository.test.ts`) because that file's hand-rolled chain mock has
 * no `rpc`; `MockSupabase` does. Same split as
 * `shiftChangeRequestRepository.rpc.test.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { DatabaseError } from '../../../../../src/errors';
import { MockSupabase } from '../../../../helpers/mockSupabase';

let ShiftRepository: any;
let mockSupabaseService: ReturnType<typeof MockSupabase.createMockClient>;

const editArgs = {
  shiftId: 's1',
  actorId: 'parent-1',
  startsAt: '2026-08-03T09:00:00.000Z',
  endsAt: null,
  note: null,
  setStartsAt: true,
  setEndsAt: false,
  setNote: false,
  origin: 'parent_proposed',
};

beforeAll(async () => {
  mockSupabaseService = MockSupabase.createMockClient();
  mock.module('../../../../../src/config/supabase', () => ({
    supabase: mockSupabaseService,
    supabaseService: mockSupabaseService,
  }));

  const mod = await import(
    '../../../../../src/domains/shift/repositories/shiftRepository'
  );
  ShiftRepository = mod.ShiftRepository;
});

beforeEach(() => {
  mockSupabaseService.rpc.mockClear?.();
});

describe('ShiftRepository.applyParentEdit', () => {
  it('sends only the edit intent — no client-computed sequence or audit snapshots', async () => {
    const applied = { id: 's1', sequence: 5, origin: 'parent_proposed' };
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse(applied)
    );
    const repo = new ShiftRepository();

    const result = await repo.applyParentEdit(editArgs);

    const [fnName, payload] = mockSupabaseService.rpc.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(fnName).toBe('apply_parent_shift_edit');
    expect(payload).toEqual({
      p_shift_id: 's1',
      p_actor_id: 'parent-1',
      p_starts_at: '2026-08-03T09:00:00.000Z',
      p_ends_at: null,
      p_note: null,
      p_set_starts_at: true,
      p_set_ends_at: false,
      p_set_note: false,
      p_origin: 'parent_proposed',
    });
    // Asserted on the KEYS, not just the values: a `p_sequence: undefined`
    // left in the payload compares equal under toEqual, but it is still an
    // argument sent to an RPC whose signature no longer has that parameter.
    expect(Object.keys(payload).sort()).toEqual([
      'p_actor_id',
      'p_ends_at',
      'p_note',
      'p_origin',
      'p_set_ends_at',
      'p_set_note',
      'p_set_starts_at',
      'p_shift_id',
      'p_starts_at',
    ]);
    expect(result).toEqual(applied as any);
  });

  it('throws DatabaseError when the RPC errors', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createErrorResponse('boom')
    );
    const repo = new ShiftRepository();

    await expect(repo.applyParentEdit(editArgs)).rejects.toBeInstanceOf(
      DatabaseError
    );
  });

  it('throws DatabaseError when the RPC returns no row', async () => {
    mockSupabaseService.rpc.mockImplementation(async () =>
      MockSupabase.createSuccessResponse(null)
    );
    const repo = new ShiftRepository();

    await expect(repo.applyParentEdit(editArgs)).rejects.toBeInstanceOf(
      DatabaseError
    );
  });
});

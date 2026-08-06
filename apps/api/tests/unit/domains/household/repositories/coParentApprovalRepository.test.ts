import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { ApprovalNotPendingError } from '../../../../../src/domains/household/errors/approvalErrors';

let CoParentApprovalRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    lt: mock(() => chain),
    update: mock(() => chain),
    order: mock(() => chain),
    single: mock(() => Promise.resolve(finalResponse)),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: any) => Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/household/repositories/coParentApprovalRepository'
  );
  CoParentApprovalRepository = mod.CoParentApprovalRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('CoParentApprovalRepository.listPendingByHousehold', () => {
  it('returns pending rows for the household', async () => {
    const rows = [{ id: 'a1', household_id: 'h1', status: 'pending' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new CoParentApprovalRepository();
    expect(await repo.listPendingByHousehold('h1')).toEqual(rows);
  });

  it('returns [] when there are none', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new CoParentApprovalRepository();
    expect(await repo.listPendingByHousehold('h1')).toEqual([]);
  });
});

describe('CoParentApprovalRepository.respond', () => {
  it('updates status, responded_by, and responded_at with CAS on pending', async () => {
    const updated = { id: 'a1', status: 'approved', responded_by: 'u1' };
    const chain = createMockQueryChain({ data: updated, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();
    const result = await repo.respond('a1', 'approved', 'u1');
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', responded_by: 'u1' })
    );
    expect(chain.eq).toHaveBeenCalledWith('id', 'a1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
    expect(chain.maybeSingle).toHaveBeenCalled();
    expect(result).toEqual(updated);
  });

  it('throws ApprovalNotPendingError when no pending row matches', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new CoParentApprovalRepository();
    await expect(repo.respond('a1', 'approved', 'u1')).rejects.toBeInstanceOf(
      ApprovalNotPendingError
    );
  });
});

describe('CoParentApprovalRepository.recordFailedApply', () => {
  function approval(payload: Record<string, unknown> = {}) {
    return {
      id: 'a1',
      household_id: 'h1',
      action: 'extra_shift',
      payload,
      timeout_at: '2000-01-01T00:00:00.000Z',
    };
  }

  it('sends a first failure back to pending with a bumped attempt count and a FUTURE timeout', async () => {
    const chain = createMockQueryChain({
      data: { id: 'a1', status: 'pending' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();

    const outcome = await repo.recordFailedApply(
      approval({ shift_id: 's1' }),
      'approved',
      'shift is gone'
    );

    expect(outcome).toBe('retrying');
    const [patch] = chain.update.mock.calls[0];
    expect(patch.status).toBe('pending');
    expect(patch.payload).toMatchObject({
      shift_id: 's1',
      apply_attempts: 1,
      apply_error: 'shift is gone',
    });
    // Leaving timeout_at in the past means the next on-read expiry re-applies
    // it immediately — a retry loop on every list read.
    expect(new Date(patch.timeout_at).getTime()).toBeGreaterThan(Date.now());
    expect(chain.eq).toHaveBeenCalledWith('id', 'a1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'approved');
  });

  it('gives up TERMINALLY once the attempts are spent, so nothing can loop forever', async () => {
    const chain = createMockQueryChain({
      data: { id: 'a1', status: 'withdrawn' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();

    const outcome = await repo.recordFailedApply(
      approval({ shift_id: 's1', apply_attempts: 1 }),
      'timed_out',
      'shift already started'
    );

    expect(outcome).toBe('failed');
    const [patch] = chain.update.mock.calls[0];
    expect(patch.status).toBe('withdrawn');
    expect(patch.payload).toMatchObject({
      apply_attempts: 2,
      apply_error: 'shift already started',
    });
    expect(patch.timeout_at).toBeUndefined();
    expect(chain.eq).toHaveBeenCalledWith('status', 'timed_out');
  });

  it('reports a MISSED CAS instead of claiming the attempt was recorded', async () => {
    // The row moved between the applier failing and this write (a concurrent
    // sweep or respond), so the update hits zero rows and `apply_attempts` is
    // never persisted. Deciding the outcome from the in-memory counter would
    // report "gave up, now withdrawn" for a row that is neither — and the next
    // failure would read the OLD counter and start again from one, which is
    // the unbounded loop restored.
    const chain = createMockQueryChain({ data: null, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();

    const outcome = await repo.recordFailedApply(
      approval({ shift_id: 's1', apply_attempts: 1 }),
      'approved',
      'shift is gone'
    );

    expect(outcome).toBe('missed');
    expect(chain.maybeSingle).toHaveBeenCalled();
  });

  it('does NOT spend an attempt when the failure was an unregistered action', async () => {
    // Nothing was written by a missing applier, so there is no partial state to
    // protect against — and burning attempts would convert a deploy bug into
    // permanently lost mutations.
    const chain = createMockQueryChain({
      data: { id: 'a1', status: 'pending' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();

    const outcome = await repo.recordFailedApply(
      approval({ shift_id: 's1', apply_attempts: 1 }),
      'approved',
      'no applier',
      false
    );

    expect(outcome).toBe('retrying');
    const [patch] = chain.update.mock.calls[0];
    expect(patch.status).toBe('pending');
    expect(patch.payload.apply_attempts).toBe(1);
  });

  it('throws a DatabaseError when the write fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new CoParentApprovalRepository();
    await expect(
      repo.recordFailedApply(approval(), 'approved', 'nope')
    ).rejects.toThrow('Failed to record a failed approval apply');
  });
});

describe('CoParentApprovalRepository.clearApplyMarkers', () => {
  it('drops the stale attempt count and error once an apply finally succeeds', async () => {
    const chain = createMockQueryChain({ data: null, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();

    await repo.clearApplyMarkers({
      id: 'a1',
      payload: { shift_id: 's1', apply_attempts: 1, apply_error: 'boom' },
    });

    expect(chain.update).toHaveBeenCalledWith({ payload: { shift_id: 's1' } });
    expect(chain.eq).toHaveBeenCalledWith('id', 'a1');
  });

  it('writes nothing when there are no markers to clear', async () => {
    const chain = createMockQueryChain({ data: null, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();

    await repo.clearApplyMarkers({ id: 'a1', payload: { shift_id: 's1' } });

    expect(chain.update).not.toHaveBeenCalled();
  });
});

describe('CoParentApprovalRepository.expireTimedOut', () => {
  it('flips past-due pending rows to timed_out and returns them', async () => {
    const expired = [{ id: 'a1', status: 'timed_out' }];
    const chain = createMockQueryChain({ data: expired, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();
    const result = await repo.expireTimedOut('2026-01-01T00:00:00.000Z');
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'timed_out' })
    );
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
    expect(chain.lt).toHaveBeenCalledWith(
      'timeout_at',
      '2026-01-01T00:00:00.000Z'
    );
    expect(result).toEqual(expired);
  });

  it('scopes to one household when a householdId is given', async () => {
    const chain = createMockQueryChain({ data: [], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();
    await repo.expireTimedOut('2026-01-01T00:00:00.000Z', 'h1');
    expect(chain.eq).toHaveBeenCalledWith('household_id', 'h1');
  });
});

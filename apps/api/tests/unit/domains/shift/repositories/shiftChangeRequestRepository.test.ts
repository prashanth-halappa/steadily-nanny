import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { ChangeRequestNotPendingError } from '../../../../../src/domains/shift/errors/shiftErrors';

let ShiftChangeRequestRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    neq: mock(() => chain),
    in: mock(() => chain),
    order: mock(() => chain),
    update: mock(() => chain),
    insert: mock(() => chain),
    single: mock(() => Promise.resolve(finalResponse)),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/shift/repositories/shiftChangeRequestRepository'
  );
  ShiftChangeRequestRepository = mod.ShiftChangeRequestRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('ShiftChangeRequestRepository.respond', () => {
  it('writes response_message (never message) and CAS on status=pending', async () => {
    const updated = {
      id: 'cr1',
      status: 'accepted',
      message: 'requester note',
      response_message: 'ok',
    };
    const chain = createMockQueryChain({ data: updated, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new ShiftChangeRequestRepository();

    const result = await repo.respond('cr1', 'accepted', 'carer-1', 'ok');

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'accepted',
        responded_by: 'carer-1',
        response_message: 'ok',
      })
    );
    const updateArg = chain.update.mock.calls[0][0];
    expect(updateArg).not.toHaveProperty('message');
    expect(chain.eq).toHaveBeenCalledWith('id', 'cr1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
    expect(chain.maybeSingle).toHaveBeenCalled();
    expect(result).toEqual(updated);
  });

  it('throws ChangeRequestNotPendingError when no pending row matches', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ShiftChangeRequestRepository();
    await expect(
      repo.respond('cr1', 'declined', 'carer-1')
    ).rejects.toBeInstanceOf(ChangeRequestNotPendingError);
  });
});

describe('ShiftChangeRequestRepository.listPendingByShiftIds', () => {
  it('returns [] without hitting the DB when shiftIds is empty', async () => {
    const repo = new ShiftChangeRequestRepository();
    expect(await repo.listPendingByShiftIds([])).toEqual([]);
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });

  it('filters pending rows for the given shift ids', async () => {
    const rows = [{ id: 'cr1', status: 'pending', shift_id: 's1' }];
    const chain = createMockQueryChain({ data: rows, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new ShiftChangeRequestRepository();

    const result = await repo.listPendingByShiftIds(['s1', 's2']);

    expect(chain.in).toHaveBeenCalledWith('shift_id', ['s1', 's2']);
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
    expect(result).toEqual(rows);
  });
});

describe('ShiftChangeRequestRepository.withdraw', () => {
  it('CAS on status=pending', async () => {
    const updated = { id: 'cr1', status: 'withdrawn' };
    const chain = createMockQueryChain({ data: updated, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new ShiftChangeRequestRepository();

    const result = await repo.withdraw('cr1');

    expect(chain.update).toHaveBeenCalledWith({ status: 'withdrawn' });
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
    expect(result).toEqual(updated);
  });

  it('throws ChangeRequestNotPendingError when no pending row matches', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ShiftChangeRequestRepository();
    await expect(repo.withdraw('cr1')).rejects.toBeInstanceOf(
      ChangeRequestNotPendingError
    );
  });
});

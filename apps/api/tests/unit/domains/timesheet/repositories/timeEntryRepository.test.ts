import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimeEntryRepository: any;
let AlreadyClockedInError: any;
let CancellationPaidAlreadyRecordedError: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown; count?: number | null } = {
    data: null,
    error: null,
  }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    gte: mock(() => chain),
    lt: mock(() => chain),
    order: mock(() => chain),
    insert: mock(() => chain),
    update: mock(() => chain),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    single: mock(() => Promise.resolve(finalResponse)),
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
    '../../../../../src/domains/timesheet/repositories/timeEntryRepository'
  );
  TimeEntryRepository = mod.TimeEntryRepository;
  const errors = await import(
    '../../../../../src/domains/timesheet/errors/timesheetErrors'
  );
  AlreadyClockedInError = errors.AlreadyClockedInError;
  CancellationPaidAlreadyRecordedError =
    errors.CancellationPaidAlreadyRecordedError;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('TimeEntryRepository.clockIn', () => {
  it('creates a running entry', async () => {
    const created = {
      id: 't1',
      carer_id: 'carer-1',
      carer_display_name: 'Nia Rowe',
      status: 'running',
    };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: created, error: null })
    );
    const repo = new TimeEntryRepository();
    const result = await repo.clockIn({
      household_id: 'h1',
      carer_id: 'carer-1',
      carer_display_name: 'Nia Rowe',
      shift_id: null,
      clock_in_at: '2026-08-03T08:00:00.000Z',
      timezone: 'Europe/London',
      kind: 'worked',
      status: 'running',
    });
    expect(result).toEqual(created);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('time_entries');
  });

  it('translates a 23505 unique-violation into AlreadyClockedInError, not a raw 500', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      })
    );
    const repo = new TimeEntryRepository();
    await expect(
      repo.clockIn({
        household_id: 'h1',
        carer_id: 'carer-1',
        carer_display_name: 'Nia Rowe',
        shift_id: null,
        clock_in_at: '2026-08-03T08:00:00.000Z',
        timezone: 'Europe/London',
        kind: 'worked',
        status: 'running',
      })
    ).rejects.toBeInstanceOf(AlreadyClockedInError);
  });
});

describe('TimeEntryRepository.createSubmitted', () => {
  it('translates a cancellation_paid 23505 into CancellationPaidAlreadyRecordedError', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      })
    );
    const repo = new TimeEntryRepository();
    await expect(
      repo.createSubmitted({
        household_id: 'h1',
        carer_id: 'carer-1',
        carer_display_name: 'Nia Rowe',
        shift_id: 's1',
        clock_in_at: '2026-08-03T09:00:00.000Z',
        clock_out_at: '2026-08-03T17:00:00.000Z',
        break_minutes: 0,
        scheduled_minutes: 480,
        timezone: 'Europe/London',
        kind: 'cancellation_paid',
        status: 'submitted',
        note: null,
      })
    ).rejects.toBeInstanceOf(CancellationPaidAlreadyRecordedError);
  });
});

describe('TimeEntryRepository.findRunningForCarer', () => {
  it('returns the running entry when one exists', async () => {
    const running = { id: 't1', carer_id: 'carer-1', status: 'running' };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: running, error: null })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.findRunningForCarer('carer-1')).toEqual(running);
  });

  it('returns null when no entry is running', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.findRunningForCarer('carer-1')).toBeNull();
  });
});

describe('TimeEntryRepository.hasTimeEntries', () => {
  it('returns true when at least one entry exists for the shift', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null, count: 2 })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.hasTimeEntries('shift-1')).toBe(true);
  });

  it('returns false when the count is zero', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null, count: 0 })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.hasTimeEntries('shift-1')).toBe(false);
  });

  it('returns false when count is null', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null, count: null })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.hasTimeEntries('shift-1')).toBe(false);
  });
});

describe('TimeEntryRepository.listForHouseholdWeek', () => {
  it('lists a household week, newest clock-in first', async () => {
    const rows = [{ id: 't1', household_id: 'h1' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new TimeEntryRepository();
    const result = await repo.listForHouseholdWeek(
      'h1',
      '2026-08-03',
      '2026-08-10'
    );
    expect(result).toEqual(rows);
  });

  it('returns [] when the query returns no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimeEntryRepository();
    expect(
      await repo.listForHouseholdWeek('h1', '2026-08-03', '2026-08-10')
    ).toEqual([]);
  });
});

describe('TimeEntryRepository.listForCarerWeek', () => {
  it('lists one carer entries for the week, scoped to household + carer', async () => {
    const rows = [{ id: 't1', household_id: 'h1', carer_id: 'carer-1' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new TimeEntryRepository();
    const result = await repo.listForCarerWeek(
      'h1',
      'carer-1',
      '2026-08-03',
      '2026-08-10'
    );
    expect(result).toEqual(rows);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('time_entries');
  });

  it('returns [] when the query returns no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimeEntryRepository();
    expect(
      await repo.listForCarerWeek('h1', 'carer-1', '2026-08-03', '2026-08-10')
    ).toEqual([]);
  });
});

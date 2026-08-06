/**
 * `ReminderLogRepository` against a fake PostgREST chain that actually
 * evaluates eq filters against in-memory rows (see
 * `expenseRepository.test.ts`) — a recording-only chain would pass even if
 * `release` forgot to scope its delete to a single `(user_id, reminder_key)`
 * pair, which is exactly the bug this file exists to catch.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

interface FakeRow {
  [key: string]: unknown;
}

let ReminderLogRepository: any;
let mockSupabaseService: any;

function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  let isInsert = false;
  let insertRow: FakeRow | null = null;
  let isDelete = false;

  const matches = (row: FakeRow): boolean =>
    eqFilters.every(([key, value]) => row[key] === value);

  const chain: any = {
    insert: mock((row: FakeRow) => {
      isInsert = true;
      insertRow = row;
      return chain;
    }),
    delete: mock(() => {
      isDelete = true;
      return chain;
    }),
    eq: mock((key: string, value: unknown) => {
      eqFilters.push([key, value]);
      return chain;
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        (() => {
          if (error) return { data: null, error };
          if (isInsert && insertRow) {
            const already = rows.some(
              row =>
                row.user_id === (insertRow as FakeRow).user_id &&
                row.reminder_key === (insertRow as FakeRow).reminder_key
            );
            if (already) {
              return {
                data: null,
                error: { code: '23505', message: 'duplicate key value' },
              };
            }
            rows.push({ ...insertRow });
            return { data: insertRow, error: null };
          }
          if (isDelete) {
            const remaining = rows.filter(row => !matches(row));
            const deletedCount = rows.length - remaining.length;
            rows.length = 0;
            rows.push(...remaining);
            return { data: { deletedCount }, error: null };
          }
          return { data: null, error: null };
        })()
      ).then(resolve),
  };
  return chain;
}

function withRows(rows: FakeRow[], error: unknown = null): void {
  mockSupabaseService.from.mockImplementation(() =>
    createFakeQuery(rows, error)
  );
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createFakeQuery([])) };
    return { supabase: obj, supabaseService: obj };
  });
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: {
      info: mock(() => undefined),
      error: mock(() => undefined),
      warn: mock(() => undefined),
      debug: mock(() => undefined),
    },
  }));

  ReminderLogRepository = (
    await import(
      '../../../../../src/domains/notification/repositories/reminderLogRepository'
    )
  ).ReminderLogRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('ReminderLogRepository.claim', () => {
  it('wins the claim on a fresh (user_id, reminder_key) pair', async () => {
    withRows([]);
    const repo = new ReminderLogRepository();
    expect(await repo.claim('user-1', 'shift_reminder:s1')).toBe(true);
  });

  it('loses the claim when the pair already exists', async () => {
    withRows([{ user_id: 'user-1', reminder_key: 'shift_reminder:s1' }]);
    const repo = new ReminderLogRepository();
    expect(await repo.claim('user-1', 'shift_reminder:s1')).toBe(false);
  });

  it('does not let one user’s existing claim block a different user’s claim for the same key', async () => {
    withRows([{ user_id: 'user-OTHER', reminder_key: 'shift_reminder:s1' }]);
    const repo = new ReminderLogRepository();
    expect(await repo.claim('user-1', 'shift_reminder:s1')).toBe(true);
  });
});

describe('ReminderLogRepository.release', () => {
  it('deletes only the matching (user_id, reminder_key) row', async () => {
    const rows: FakeRow[] = [
      { user_id: 'user-1', reminder_key: 'shift_reminder:s1' },
      { user_id: 'user-1', reminder_key: 'shift_reminder:s2' },
      { user_id: 'user-2', reminder_key: 'shift_reminder:s1' },
    ];
    withRows(rows);
    const repo = new ReminderLogRepository();

    await repo.release('user-1', 'shift_reminder:s1');

    expect(rows).toEqual([
      { user_id: 'user-1', reminder_key: 'shift_reminder:s2' },
      { user_id: 'user-2', reminder_key: 'shift_reminder:s1' },
    ]);
  });

  it('lets a released claim be re-claimed', async () => {
    const rows: FakeRow[] = [
      { user_id: 'user-1', reminder_key: 'shift_reminder:s1' },
    ];
    withRows(rows);
    const repo = new ReminderLogRepository();

    await repo.release('user-1', 'shift_reminder:s1');
    expect(await repo.claim('user-1', 'shift_reminder:s1')).toBe(true);
  });

  it('does not throw when the delete fails (best-effort, logged only)', async () => {
    withRows([], { message: 'boom' });
    const repo = new ReminderLogRepository();
    await expect(
      repo.release('user-1', 'shift_reminder:s1')
    ).resolves.toBeUndefined();
  });
});

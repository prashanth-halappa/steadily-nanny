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

type Predicate = (row: FakeRow) => boolean;

function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const filters: Predicate[] = [];
  let isInsert = false;
  let insertRow: FakeRow | null = null;
  let isDelete = false;
  let updatePatch: FakeRow | null = null;

  const matches = (row: FakeRow): boolean =>
    filters.every(predicate => predicate(row));

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
    update: mock((patch: FakeRow) => {
      updatePatch = patch;
      return chain;
    }),
    eq: mock((key: string, value: unknown) => {
      filters.push(row => row[key] === value);
      return chain;
    }),
    is: mock((key: string, value: unknown) => {
      filters.push(row => (row[key] ?? null) === value);
      return chain;
    }),
    lt: mock((key: string, value: unknown) => {
      filters.push(row => String(row[key]) < String(value));
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
          if (updatePatch) {
            for (const row of rows) {
              if (matches(row)) Object.assign(row, updatePatch);
            }
            return { data: null, error: null };
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

/**
 * C3 — the two-phase half. A claim is a reservation until the send confirms
 * it; an unconfirmed reservation left behind by a crashed run must not
 * suppress the reminder forever.
 */
describe('ReminderLogRepository.confirm', () => {
  it('stamps confirmed_at on exactly the matching row', async () => {
    const rows: FakeRow[] = [
      { user_id: 'user-1', reminder_key: 'k1', confirmed_at: null },
      { user_id: 'user-1', reminder_key: 'k2', confirmed_at: null },
      { user_id: 'user-2', reminder_key: 'k1', confirmed_at: null },
    ];
    withRows(rows);
    const repo = new ReminderLogRepository();

    await repo.confirm('user-1', 'k1');

    expect(rows[0]?.confirmed_at).not.toBeNull();
    expect(rows[1]?.confirmed_at).toBeNull();
    expect(rows[2]?.confirmed_at).toBeNull();
  });
});

describe('ReminderLogRepository.sweepStaleClaims', () => {
  const hoursAgo = (hours: number) =>
    new Date(Date.now() - hours * 3_600_000).toISOString();

  it('deletes only unconfirmed claims older than the horizon', async () => {
    const rows: FakeRow[] = [
      // Crashed run: claimed, never confirmed, hours old. The only garbage.
      {
        user_id: 'u1',
        reminder_key: 'stale',
        confirmed_at: null,
        sent_at: hoursAgo(5),
      },
      // Confirmed — a real delivery. Deleting it would re-send the reminder.
      {
        user_id: 'u2',
        reminder_key: 'delivered',
        confirmed_at: hoursAgo(5),
        sent_at: hoursAgo(5),
      },
      // Unconfirmed but recent: could be the pass that is running right now.
      {
        user_id: 'u3',
        reminder_key: 'in-flight',
        confirmed_at: null,
        sent_at: hoursAgo(0.1),
      },
    ];
    withRows(rows);
    const repo = new ReminderLogRepository();

    await repo.sweepStaleClaims();

    expect(rows.map(row => row.reminder_key)).toEqual([
      'delivered',
      'in-flight',
    ]);
  });

  it('does not throw when the sweep fails (best-effort, logged only)', async () => {
    withRows([], { message: 'boom' });
    const repo = new ReminderLogRepository();
    await expect(repo.sweepStaleClaims()).resolves.toBeUndefined();
  });
});

/**
 * ShiftEventRepository on a real D1 — including migration 025's keyed
 * unique index (`shift_events_keyed_unique_idx`), whose behaviour replaces
 * the old Postgres-text contract test (shiftEventsKeyedUnique).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import type {
  NewShiftEventInput,
  ShiftEventRepository as Repo,
} from '../../../../../src/domains/shift/repositories/shiftEventRepository';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';
import { seedHousehold } from '../../schedule/repositories/seed';
import { HH, resetShiftTables, seedBase, seedShift } from './changeRequestSeed';

let t: TestDb;
let repo: Repo;
let shiftId: string;
const HH2 = 'hh-2';
const DAY = '2026-08-03';

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { ShiftEventRepository } = await import(
    '../../../../../src/domains/shift/repositories/shiftEventRepository'
  );
  repo = new ShiftEventRepository();
  await seedBase(t);
  await seedHousehold(t, HH2);
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await resetShiftTables(t);
  shiftId = await seedShift(t, {
    starts_at: '2026-08-03T08:00:00.000Z',
    ends_at: '2026-08-03T16:00:00.000Z',
  });
});

const ev = (over: Partial<NewShiftEventInput> = {}): NewShiftEventInput => ({
  household_id: HH,
  shift_id: null,
  local_date: DAY,
  actor_id: null,
  event_type: 'uncovered_care',
  payload: {},
  ...over,
});

async function insertRaw(
  e: Partial<NewShiftEventInput> & { created_at?: string; id?: string }
): Promise<string> {
  const row = { ...ev(e), id: e.id ?? crypto.randomUUID() };
  await t.d1
    .prepare(
      `INSERT INTO shift_events (id, household_id, shift_id, local_date, actor_id, event_type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.household_id,
      row.shift_id,
      row.local_date,
      row.actor_id,
      row.event_type,
      JSON.stringify(row.payload),
      e.created_at ?? new Date().toISOString()
    )
    .run();
  return row.id;
}

const count = async () =>
  (await t.d1
    .prepare('SELECT count(*) AS n FROM shift_events')
    .first('n')) as number;

describe('listForShift / listForHouseholdDate', () => {
  it('listForShift: that shift in that household only, oldest first', async () => {
    const late = await insertRaw({
      shift_id: shiftId,
      event_type: 'shift_updated',
      created_at: '2026-08-03T10:00:00.000Z',
    });
    const early = await insertRaw({
      shift_id: shiftId,
      event_type: 'shift_created',
      created_at: '2026-08-03T09:00:00.000Z',
    });
    await insertRaw({ shift_id: null, event_type: 'gap_raised' });
    const rows = await repo.listForShift(HH, shiftId);
    expect(rows.map(r => r.id)).toEqual([early, late]);
    expect(await repo.listForShift(HH2, shiftId)).toEqual([]);
  });

  it('listForHouseholdDate: includes null-shift rows, excludes other dates/households, oldest first', async () => {
    const b = await insertRaw({
      shift_id: shiftId,
      event_type: 'shift_updated',
      created_at: '2026-08-03T11:00:00.000Z',
    });
    const a = await insertRaw({
      shift_id: null,
      event_type: 'gap_raised',
      payload: { note: 'x' },
      created_at: '2026-08-03T10:00:00.000Z',
    });
    await insertRaw({ local_date: '2026-08-04' });
    await insertRaw({ household_id: HH2 });
    const rows = await repo.listForHouseholdDate(HH, DAY);
    expect(rows.map(r => r.id)).toEqual([a, b]);
    expect(rows[0]?.payload).toEqual({ note: 'x' });
  });
});

describe('listEventKeysForDate', () => {
  it('collects string payload.key values for household/date/type only', async () => {
    await insertRaw({ payload: { key: 'k1' } });
    await insertRaw({ payload: { key: 'k2' } });
    await insertRaw({ payload: {} });
    await insertRaw({ payload: { key: 42 } });
    await insertRaw({ payload: { key: 'other-type' }, event_type: 'x' });
    await insertRaw({
      payload: { key: 'other-day' },
      local_date: '2026-08-04',
    });
    await insertRaw({ payload: { key: 'other-hh' }, household_id: HH2 });
    expect(await repo.listEventKeysForDate(HH, DAY, 'uncovered_care')).toEqual(
      new Set(['k1', 'k2'])
    );
  });

  it('returns an empty Set when nothing matches', async () => {
    expect(await repo.listEventKeysForDate(HH, DAY, 'uncovered_care')).toEqual(
      new Set()
    );
  });
});

describe('keyed unique index (migration 025)', () => {
  it('refuses a second row with the same household/date/type/key', async () => {
    await insertRaw({ payload: { key: 'k1' } });
    await expect(insertRaw({ payload: { key: 'k1' } })).rejects.toThrow(
      /shift_events_keyed_unique_idx/
    );
  });

  it('allows the same key on another date, type or household, and unkeyed rows freely', async () => {
    await insertRaw({ payload: { key: 'k1' } });
    await insertRaw({ payload: { key: 'k1' }, local_date: '2026-08-04' });
    await insertRaw({ payload: { key: 'k1' }, event_type: 'pattern_conflict' });
    await insertRaw({ payload: { key: 'k1' }, household_id: HH2 });
    await insertRaw({ payload: {} });
    await insertRaw({ payload: {} });
    expect(await count()).toBe(6);
  });
});

describe('insertMany', () => {
  it('is a no-op for an empty array', async () => {
    expect(await repo.insertMany([])).toEqual([]);
    expect(await count()).toBe(0);
  });

  it('batch path: inserts all rows and returns them with ids and parsed payloads', async () => {
    const rows = await repo.insertMany([
      ev({ payload: { key: 'k1' } }),
      ev({ shift_id: shiftId, event_type: 'shift_updated', payload: { a: 1 } }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ payload: { key: 'k1' }, shift_id: null });
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[1]).toMatchObject({ shift_id: shiftId, payload: { a: 1 } });
    expect(await count()).toBe(2);
  });

  it('keyed-duplicate fallback: skips only the duplicate, returns only the rows it created', async () => {
    await insertRaw({ payload: { key: 'k2' } }); // a concurrent writer won k2
    const rows = await repo.insertMany([
      ev({ payload: { key: 'k1' } }),
      ev({ payload: { key: 'k2' } }),
      ev({ payload: { key: 'k3' } }),
    ]);
    expect(rows.map(r => r.payload.key)).toEqual(['k1', 'k3']);
    expect(await count()).toBe(3);
    expect(await repo.listEventKeysForDate(HH, DAY, 'uncovered_care')).toEqual(
      new Set(['k1', 'k2', 'k3'])
    );
  });

  it('returns [] when every row loses to a concurrent writer', async () => {
    await insertRaw({ payload: { key: 'k1' } });
    expect(await repo.insertMany([ev({ payload: { key: 'k1' } })])).toEqual([]);
    expect(await count()).toBe(1);
  });

  it('a non-keyed constraint error (FK) throws DatabaseError and writes nothing', async () => {
    await expect(
      repo.insertMany([
        ev({ payload: { key: 'k1' } }),
        ev({ household_id: 'no-such-household' }),
      ])
    ).rejects.toMatchObject({ name: 'DatabaseError' });
    expect(await count()).toBe(0);
  });

  it('a non-keyed error in the row-by-row fallback still throws', async () => {
    await insertRaw({ payload: { key: 'k1' } });
    await expect(
      repo.insertMany([
        ev({ payload: { key: 'k1' } }), // duplicate → fallback
        ev({ actor_id: 'no-such-user' }), // FK in the fallback
      ])
    ).rejects.toMatchObject({ name: 'DatabaseError' });
  });

  it('chunks >12 rows into one all-or-nothing batch', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      ev({ payload: { key: `k${i}` } })
    );
    const rows = await repo.insertMany(many);
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map(r => r.payload.key)).size).toBe(30);
    expect(await count()).toBe(30);
  });

  it('a duplicate in a later chunk rolls back the earlier chunks, then the fallback inserts each once', async () => {
    await insertRaw({ payload: { key: 'k25' } });
    const many = Array.from({ length: 30 }, (_, i) =>
      ev({ payload: { key: `k${i}` } })
    );
    const rows = await repo.insertMany(many);
    expect(rows).toHaveLength(29);
    expect(rows.some(r => r.payload.key === 'k25')).toBe(false);
    expect(await count()).toBe(30);
  });
});

describe('deleteSweptEventsOlderThan', () => {
  const CUTOFF = '2026-08-10T00:00:00.000Z';

  it('deletes only allowlisted types older than the cutoff and returns the count', async () => {
    const old = '2026-08-01T00:00:00.000Z';
    await insertRaw({ event_type: 'uncovered_care', created_at: old });
    await insertRaw({ event_type: 'pattern_conflict', created_at: old });
    const keepNew = await insertRaw({
      event_type: 'uncovered_care',
      created_at: '2026-08-11T00:00:00.000Z',
    });
    const keepType = await insertRaw({
      event_type: 'change_request_created',
      shift_id: shiftId,
      created_at: old,
    });
    const keepCancel = await insertRaw({
      event_type: 'shift_cancelled',
      shift_id: shiftId,
      created_at: old,
    });

    const n = await repo.deleteSweptEventsOlderThan(
      '2026-08-10T01:00:00+01:00', // = CUTOFF
      ['uncovered_care', 'pattern_conflict']
    );

    expect(n).toBe(2);
    const { results } = await t.d1
      .prepare('SELECT id FROM shift_events ORDER BY id')
      .all<{ id: string }>();
    expect(results.map((r: { id: string }) => r.id).sort()).toEqual(
      [keepNew, keepType, keepCancel].sort()
    );
  });

  it('an empty allowlist deletes nothing', async () => {
    await insertRaw({ created_at: '2026-08-01T00:00:00.000Z' });
    expect(await repo.deleteSweptEventsOlderThan(CUTOFF, [])).toBe(0);
    expect(await count()).toBe(1);
  });
});

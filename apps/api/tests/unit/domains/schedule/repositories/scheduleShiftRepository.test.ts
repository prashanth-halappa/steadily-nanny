/**
 * ScheduleShiftRepository on a real D1 (tests/helpers/testDb.ts): the batch
 * writes behind `respond`, `local_date` derivation (no trigger on D1), and the
 * collision/overlap translation the materialiser depends on — 062's window
 * unique index and 104's carer-overlap guard, raised by the real schema.
 *
 * @module tests/unit/domains/schedule/repositories/scheduleShiftRepository
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
import { createTestDb, type TestDb } from '../../../../helpers/testDb';
import { seedChild, seedHousehold, seedPattern, seedUser } from './seed';

type Repo = InstanceType<
  typeof import('../../../../../src/domains/schedule/repositories/scheduleShiftRepository').ScheduleShiftRepository
>;

let t: TestDb;
let repo: Repo;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const mod = await import(
    '../../../../../src/domains/schedule/repositories/scheduleShiftRepository'
  );
  repo = new mod.ScheduleShiftRepository();
  await seedUser(t, 'carer-1');
  await seedHousehold(t, 'h1');
  await seedChild(t, 'c1', 'h1');
  await seedChild(t, 'c2', 'h1');
  await seedPattern(t, 'p1', 'h1', { carerId: 'carer-1' });
  await seedPattern(t, 'p2', 'h1', { carerId: 'carer-1' });
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await t.d1.prepare('DELETE FROM shifts').run();
});

function shiftRow(day: number, overrides: Record<string, unknown> = {}) {
  const dd = String(day).padStart(2, '0');
  return {
    household_id: 'h1',
    carer_id: 'carer-1' as string | null,
    starts_at: `2026-06-${dd}T07:00:00.000Z`,
    ends_at: `2026-06-${dd}T16:00:00.000Z`,
    timezone: 'Europe/London',
    kind: 'recurring' as const,
    status: 'confirmed' as const,
    source_pattern_id: 'p1' as string | null,
    origin: 'system_generated' as const,
    note: null,
    ical_uid: `uid::2026-06-${dd}::${Math.random()}`,
    ...overrides,
  };
}

describe('ScheduleShiftRepository.create', () => {
  it('derives local_date in the shift’s own timezone', async () => {
    // 23:30Z on 1 June is 2 June in Auckland.
    const created = await repo.create(
      shiftRow(1, {
        starts_at: '2026-06-01T23:30:00.000Z',
        ends_at: '2026-06-02T03:00:00.000Z',
        timezone: 'Pacific/Auckland',
      })
    );
    expect(created.local_date).toBe('2026-06-02');
    expect(created.is_short_notice).toBe(false);
  });

  it('throws RecurringShiftAlreadyExistsError on 062’s exact-window collision (open shift)', async () => {
    await repo.create(shiftRow(1, { carer_id: null, status: 'pending' }));
    await expect(
      repo.create(shiftRow(1, { carer_id: null, status: 'pending' }))
    ).rejects.toMatchObject({ name: 'RecurringShiftAlreadyExistsError' });
  });

  // D1's overlap guard is a BEFORE INSERT trigger, so it fires ahead of the
  // unique index for an identical carer window. The adopt path must survive.
  it('still throws RecurringShiftAlreadyExistsError for an identical window with a carer', async () => {
    await repo.create(shiftRow(1, { source_pattern_id: 'p2' }));
    await expect(repo.create(shiftRow(1))).rejects.toMatchObject({
      name: 'RecurringShiftAlreadyExistsError',
    });
  });

  it('throws ShiftOverlapsError when the window only overlaps a live shift of the carer', async () => {
    await repo.create(shiftRow(1));
    await expect(
      repo.create(
        shiftRow(1, {
          starts_at: '2026-06-01T10:00:00.000Z',
          ends_at: '2026-06-01T18:00:00.000Z',
        })
      )
    ).rejects.toMatchObject({ name: 'ShiftOverlapsError' });
  });

  it('throws a DatabaseError for any other unique key (ical_uid)', async () => {
    await repo.create(shiftRow(1, { ical_uid: 'dup' }));
    await expect(
      repo.create(shiftRow(2, { ical_uid: 'dup' }))
    ).rejects.toMatchObject({ name: 'DatabaseError' });
  });
});

describe('ScheduleShiftRepository.createMany', () => {
  it('inserts every row (across chunks under D1’s param cap) and returns them', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => shiftRow(i + 1));
    const created = await repo.createMany(rows);
    expect(created).toHaveLength(20);
    expect(created?.map(s => s.local_date).sort()[0]).toBe('2026-06-01');
    expect(await repo.findActiveByPattern('p1')).toHaveLength(20);
  });

  it('asks the DB nothing for an empty batch', async () => {
    expect(await repo.createMany([])).toEqual([]);
  });

  it('returns null and writes NOTHING on 062’s window collision so the caller can retry per row', async () => {
    await repo.create(shiftRow(3, { carer_id: null, status: 'pending' }));
    const rows = Array.from({ length: 10 }, (_, i) =>
      shiftRow(i + 1, { carer_id: null, status: 'pending' })
    );
    expect(await repo.createMany(rows)).toBeNull();
    expect(await repo.findActiveByPattern('p1')).toHaveLength(1);
  });

  it('returns null on a carer overlap too', async () => {
    await repo.create(shiftRow(3));
    expect(
      await repo.createMany([
        shiftRow(2),
        shiftRow(3, { starts_at: '2026-06-03T08:00:00.000Z' }),
      ])
    ).toBeNull();
    expect(await repo.findActiveByPattern('p1')).toHaveLength(1);
  });

  it('still throws on any OTHER database error — a null must only ever mean "window collision"', async () => {
    await expect(
      repo.createMany([
        shiftRow(1, { ical_uid: 'dup' }),
        shiftRow(2, { ical_uid: 'dup' }),
      ])
    ).rejects.toThrow('Failed to create shifts');
  });
});

describe('ScheduleShiftRepository.findRecurringInWindow', () => {
  it('finds a live recurring shift by exact window, matching a null carer with IS NULL', async () => {
    const open = await repo.create(
      shiftRow(1, {
        carer_id: null,
        status: 'pending',
        source_pattern_id: 'p2',
      })
    );
    expect(
      (
        await repo.findRecurringInWindow(
          'h1',
          null,
          '2026-06-01T07:00:00.000Z',
          '2026-06-01T16:00:00.000Z'
        )
      )?.id
    ).toBe(open.id);
    expect(
      await repo.findRecurringInWindow(
        'h1',
        'carer-1',
        '2026-06-01T07:00:00.000Z',
        '2026-06-01T16:00:00.000Z'
      )
    ).toBeNull();
  });

  it('ignores cancelled shifts', async () => {
    await repo.create(shiftRow(1, { status: 'cancelled' }));
    expect(
      await repo.findRecurringInWindow(
        'h1',
        'carer-1',
        '2026-06-01T07:00:00.000Z',
        '2026-06-01T16:00:00.000Z'
      )
    ).toBeNull();
  });
});

describe('ScheduleShiftRepository.update', () => {
  it('re-derives local_date when starts_at moves', async () => {
    const s = await repo.create(shiftRow(1));
    const updated = await repo.update(s.id, {
      starts_at: '2026-06-05T07:00:00.000Z',
      ends_at: '2026-06-05T16:00:00.000Z',
    });
    expect(updated.local_date).toBe('2026-06-05');
  });

  it('re-derives local_date when only the timezone changes', async () => {
    const s = await repo.create(
      shiftRow(1, {
        starts_at: '2026-06-01T23:30:00.000Z',
        ends_at: '2026-06-02T03:00:00.000Z',
      })
    );
    expect(s.local_date).toBe('2026-06-02'); // BST
    const updated = await repo.update(s.id, { timezone: 'America/New_York' });
    expect(updated.local_date).toBe('2026-06-01');
  });

  it('throws ShiftOverlapsError when re-timing onto another of the carer’s shifts', async () => {
    await repo.create(shiftRow(1));
    const s = await repo.create(shiftRow(2));
    await expect(
      repo.update(s.id, {
        starts_at: '2026-06-01T08:00:00.000Z',
        ends_at: '2026-06-01T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ name: 'ShiftOverlapsError' });
  });

  it('throws a DatabaseError for a missing id', async () => {
    await expect(repo.update('nope', { note: 'x' })).rejects.toMatchObject({
      name: 'DatabaseError',
    });
  });
});

describe('ScheduleShiftRepository batch reads and writes', () => {
  async function seedChangeRequest(shiftId: string, status: string) {
    await t.d1
      .prepare(
        "INSERT INTO shift_change_requests (id, shift_id, kind, status) VALUES (?, ?, 'cancel', ?)"
      )
      .bind(crypto.randomUUID(), shiftId, status)
      .run();
  }

  it('shiftIdsWithChangeRequests returns the set of ids with any request', async () => {
    const [s1, s2, s3] =
      (await repo.createMany([shiftRow(1), shiftRow(2), shiftRow(3)])) ?? [];
    if (!s1 || !s2 || !s3) throw new Error('seed failed');
    await seedChangeRequest(s1.id, 'pending');
    await seedChangeRequest(s1.id, 'withdrawn');
    await seedChangeRequest(s3.id, 'declined');

    const result = await repo.shiftIdsWithChangeRequests([s1.id, s2.id, s3.id]);
    expect([...result].sort()).toEqual([s1.id, s3.id].sort());
  });

  // `expired` means "nobody answered for 7 days" (064, F-B5-5), not "a human
  // touched this shift" — it must not freeze the shift from re-materialisation.
  it('shiftIdsWithChangeRequests excludes expired requests from the probe', async () => {
    const s = await repo.create(shiftRow(1));
    await seedChangeRequest(s.id, 'expired');
    expect(await repo.shiftIdsWithChangeRequests([s.id])).toEqual(new Set());
  });

  it('shiftIdsWithChangeRequests short-circuits on an empty list', async () => {
    expect(await repo.shiftIdsWithChangeRequests([])).toEqual(new Set());
  });

  it('updateMany applies one patch to every id (past one chunk) and nothing else', async () => {
    const created =
      (await repo.createMany(
        Array.from({ length: 25 }, (_, i) => shiftRow(i + 1))
      )) ?? [];
    const ids = created.slice(0, 24).map(s => s.id);
    // Widen the id list past one IN() chunk with ids that match nothing.
    const padding = Array.from({ length: 100 }, () => crypto.randomUUID());
    await repo.updateMany([...ids, ...padding], { status: 'cancelled' });

    const rows = await repo.findActiveByPattern('p1');
    expect(rows.filter(s => s.status === 'cancelled')).toHaveLength(24);
    expect(rows.filter(s => s.status === 'confirmed')).toHaveLength(1);
  });

  it('updateMany refuses a re-timing patch (local_date would go stale)', async () => {
    await expect(
      repo.updateMany(['x'], { starts_at: '2026-06-01T07:00:00.000Z' })
    ).rejects.toThrow('updateMany cannot re-time shifts');
  });

  it('updateMany and deleteMany are no-ops for an empty list', async () => {
    await repo.create(shiftRow(1));
    await repo.updateMany([], { status: 'cancelled' });
    await repo.deleteMany([]);
    const [only] = await repo.findActiveByPattern('p1');
    expect(only?.status).toBe('confirmed');
  });

  it('deleteMany removes exactly those ids', async () => {
    const [a, b, c] =
      (await repo.createMany([shiftRow(1), shiftRow(2), shiftRow(3)])) ?? [];
    if (!a || !b || !c) throw new Error('seed failed');
    await repo.deleteMany([a.id, b.id]);
    expect((await repo.findActiveByPattern('p1')).map(s => s.id)).toEqual([
      c.id,
    ]);
  });

  const childrenOf = async (shiftId: string) =>
    (
      await t.d1
        .prepare(
          'SELECT child_id FROM shift_children WHERE shift_id = ? ORDER BY child_id'
        )
        .bind(shiftId)
        .all<{ child_id: string }>()
    ).results.map((r: { child_id: string }) => r.child_id);

  it('replaceChildrenMany replaces every listed shift’s children wholesale', async () => {
    const [s1, s2] = (await repo.createMany([shiftRow(1), shiftRow(2)])) ?? [];
    if (!s1 || !s2) throw new Error('seed failed');
    await repo.replaceChildrenMany([
      {
        shiftId: s1.id,
        children: [
          { child_id: 'c1', starts_at: null, ends_at: null },
          { child_id: 'c2', starts_at: null, ends_at: null },
        ],
      },
      {
        shiftId: s2.id,
        children: [{ child_id: 'c2', starts_at: null, ends_at: null }],
      },
    ]);
    await repo.replaceChildrenMany([
      {
        shiftId: s1.id,
        children: [
          {
            child_id: 'c2',
            starts_at: '2026-06-01T08:00:00.000Z',
            ends_at: '2026-06-01T12:00:00.000Z',
          },
        ],
      },
    ]);
    expect(await childrenOf(s1.id)).toEqual(['c2']);
    expect(await childrenOf(s2.id)).toEqual(['c2']);
  });

  it('replaceChildrenMany still clears children when no shift has any', async () => {
    const s = await repo.create(shiftRow(1));
    await repo.replaceChildrenMany([
      {
        shiftId: s.id,
        children: [{ child_id: 'c1', starts_at: null, ends_at: null }],
      },
    ]);
    await repo.replaceChildrenMany([{ shiftId: s.id, children: [] }]);
    expect(await childrenOf(s.id)).toEqual([]);
  });
});

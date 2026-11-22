/** ShiftRepository on a real Miniflare D1 (tests/helpers/testDb.ts). */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { shiftChildren } from '../../../../../src/db/schema';
import {
  ExtraShiftAlreadyExistsError,
  ShiftImmutableError,
  ShiftNotFoundError,
} from '../../../../../src/domains/shift/errors/shiftErrors';
import { DatabaseError, ValidationError } from '../../../../../src/errors';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';
import {
  clearShifts,
  insertShift,
  readShift,
  seedChild,
  seedUser,
  seedWorld,
} from './seed';

let t: TestDb;
let ShiftRepository: typeof import('../../../../../src/domains/shift/repositories/shiftRepository').ShiftRepository;

const noEntries = { hasTimeEntries: async () => false };
const clockedIn = { hasTimeEntries: async () => true };
const repo = () => new ShiftRepository(noEntries);

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  ({ ShiftRepository } = await import(
    '../../../../../src/domains/shift/repositories/shiftRepository'
  ));
  await seedWorld(t);
  await seedUser(t, 'carer-2');
  await seedChild(t, 'child-1', 'h1');
  await seedChild(t, 'child-2', 'h1');
});

afterAll(() => t.dispose());

beforeEach(() => clearShifts(t));

async function attach(shiftId: string, childId: string) {
  await t.db
    .insert(shiftChildren)
    .values({ shift_id: shiftId, child_id: childId });
}

describe('ShiftRepository.findByHouseholdAndRange', () => {
  it('lists shifts overlapping the range, each carrying its shift_children', async () => {
    const s = await insertShift(t);
    await attach(s.id, 'child-1');
    const result = await repo().findByHouseholdAndRange(
      'h1',
      '2026-08-01T00:00:00.000Z',
      '2026-08-08T00:00:00.000Z'
    );
    expect(result.map(r => r.id)).toEqual([s.id]);
    expect(result[0]?.shift_children.map(c => c.child_id)).toEqual(['child-1']);
  });

  it('is strict on both ends — a shift only touching the boundary is excluded', async () => {
    const s = await insertShift(t);
    const r = repo();
    // Ends exactly at `from`.
    expect(
      await r.findByHouseholdAndRange(
        'h1',
        '2026-08-03T17:00:00.000Z',
        '2026-08-04T00:00:00.000Z'
      )
    ).toEqual([]);
    // Starts exactly at `to`, given as a ms-less `...Z` bound: canonicalised
    // before the TEXT compare, so it is not mis-ordered against the stored `.000Z`.
    expect(
      await r.findByHouseholdAndRange(
        'h1',
        '2026-08-03T00:00:00Z',
        '2026-08-03T09:00:00Z'
      )
    ).toEqual([]);
    // One ms past the boundary on either side overlaps.
    const hit = await r.findByHouseholdAndRange(
      'h1',
      '2026-08-03T00:00:00Z',
      '2026-08-03T09:00:01Z'
    );
    expect(hit.map(x => x.id)).toEqual([s.id]);
  });

  it('scopes to the household, orders by starts_at, and returns [] for no overlap', async () => {
    const later = await insertShift(t, {
      starts_at: '2026-08-04T09:00:00.000Z',
      ends_at: '2026-08-04T17:00:00.000Z',
      local_date: '2026-08-04',
    });
    const earlier = await insertShift(t);
    await insertShift(t, { household_id: 'h2' });
    const result = await repo().findByHouseholdAndRange(
      'h1',
      '2026-08-01T00:00:00.000Z',
      '2026-08-08T00:00:00.000Z'
    );
    expect(result.map(r => r.id)).toEqual([earlier.id, later.id]);
    expect(result.every(r => r.shift_children.length === 0)).toBe(true);
    expect(
      await repo().findByHouseholdAndRange(
        'h1',
        '2026-09-01T00:00:00.000Z',
        '2026-09-08T00:00:00.000Z'
      )
    ).toEqual([]);
  });
});

describe('ShiftRepository.findByHouseholdAndLocalDate', () => {
  it('lists the household local calendar date shifts with their children', async () => {
    const s = await insertShift(t);
    await attach(s.id, 'child-1');
    await attach(s.id, 'child-2');
    await insertShift(t, {
      starts_at: '2026-08-04T09:00:00.000Z',
      ends_at: '2026-08-04T17:00:00.000Z',
      local_date: '2026-08-04',
    });
    const result = await repo().findByHouseholdAndLocalDate('h1', '2026-08-03');
    expect(result.map(r => r.id)).toEqual([s.id]);
    expect(result[0]?.shift_children.map(c => c.child_id).sort()).toEqual([
      'child-1',
      'child-2',
    ]);
  });

  it('returns [] when the household has no shift that day', async () => {
    await insertShift(t, { household_id: 'h2' });
    expect(
      await repo().findByHouseholdAndLocalDate('h1', '2026-08-03')
    ).toEqual([]);
  });
});

describe('ShiftRepository.findByIdWithChildren / findByIds', () => {
  it('returns one shift with its children', async () => {
    const s = await insertShift(t);
    await attach(s.id, 'child-2');
    const row = await repo().findByIdWithChildren(s.id);
    expect(row?.id).toBe(s.id);
    expect(row?.shift_children.map(c => c.child_id)).toEqual(['child-2']);
  });

  it('returns null when the shift does not exist', async () => {
    expect(await repo().findByIdWithChildren('missing')).toBeNull();
  });

  it('findByIds batches by primary key; empty input returns []', async () => {
    const a = await insertShift(t);
    const b = await insertShift(t, { household_id: 'h2' });
    const rows = await repo().findByIds([a.id, b.id, 'missing']);
    expect(rows.map(r => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(await repo().findByIds([])).toEqual([]);
  });
});

describe('ShiftRepository.update — immutability guard', () => {
  it('updates a confirmed shift with no time entries', async () => {
    const s = await insertShift(t);
    const u = await repo().update(s.id, { note: 'hi' });
    expect(u.note).toBe('hi');
    expect((await readShift(t, s.id)).note).toBe('hi');
  });

  for (const status of ['completed', 'cancelled'] as const) {
    it(`refuses to mutate a ${status.toUpperCase()} shift and leaves it untouched`, async () => {
      const s = await insertShift(t, { status });
      await expect(
        repo().update(s.id, { starts_at: '2026-08-03T10:00:00.000Z' })
      ).rejects.toBeInstanceOf(ShiftImmutableError);
      expect((await readShift(t, s.id)).starts_at).toBe(s.starts_at);
    });
  }

  it('refuses to mutate an open shift that someone has clocked into', async () => {
    const s = await insertShift(t);
    await expect(
      new ShiftRepository(clockedIn).update(s.id, { note: 'x' })
    ).rejects.toMatchObject({
      name: 'ShiftImmutableError',
      statusCode: 409,
    });
    expect((await readShift(t, s.id)).note).toBeNull();
  });

  it('throws ShiftNotFoundError when the shift is gone', async () => {
    await expect(
      repo().update('missing', { note: 'x' })
    ).rejects.toBeInstanceOf(ShiftNotFoundError);
  });

  it('recomputes local_date when starts_at crosses local midnight', async () => {
    const s = await insertShift(t);
    // 23:30Z on 3 Aug is 00:30 BST on 4 Aug.
    const u = await repo().update(s.id, {
      starts_at: '2026-08-03T23:30:00+00:00',
      ends_at: '2026-08-04T03:00:00Z',
    });
    expect(u.starts_at).toBe('2026-08-03T23:30:00.000Z');
    expect(u.ends_at).toBe('2026-08-04T03:00:00.000Z');
    expect(u.local_date).toBe('2026-08-04');
  });

  it('recomputes local_date when only the timezone changes', async () => {
    const s = await insertShift(t, {
      starts_at: '2026-08-03T02:00:00.000Z',
      ends_at: '2026-08-03T06:00:00.000Z',
    });
    const u = await repo().update(s.id, { timezone: 'America/New_York' });
    expect(u.timezone).toBe('America/New_York');
    expect(u.local_date).toBe('2026-08-02');
  });

  it('leaves local_date alone on a patch touching neither starts_at nor timezone', async () => {
    const s = await insertShift(t, { local_date: '2026-08-03' });
    const u = await repo().update(s.id, {
      ends_at: '2026-08-03T18:00:00.000Z',
    });
    expect(u.local_date).toBe('2026-08-03');
    expect(u.ends_at).toBe('2026-08-03T18:00:00.000Z');
  });
});

describe('ShiftRepository CAS from pending (confirm / decline / withdraw)', () => {
  const cases = [
    {
      name: 'confirmPending',
      run: (r: InstanceType<typeof ShiftRepository>, id: string) =>
        r.confirmPending(id),
      expected: 'confirmed',
    },
    {
      name: 'declinePending',
      run: (r: InstanceType<typeof ShiftRepository>, id: string) =>
        r.declinePending(id),
      expected: 'declined',
    },
    {
      name: 'withdrawCoverAsk',
      run: (r: InstanceType<typeof ShiftRepository>, id: string) =>
        r.withdrawCoverAsk(id, 'parent-1', '2026-08-01T10:00:00+00:00'),
      expected: 'cancelled',
    },
  ] as const;

  for (const c of cases) {
    describe(c.name, () => {
      it(`moves pending → ${c.expected}`, async () => {
        const s = await insertShift(t, { status: 'pending' });
        const row = await c.run(repo(), s.id);
        expect(row.status).toBe(c.expected);
        expect((await readShift(t, s.id)).status).toBe(c.expected);
      });

      it('throws SHIFT_NOT_PENDING when the shift is no longer pending', async () => {
        const s = await insertShift(t, { status: 'confirmed' });
        const err = await c.run(repo(), s.id).catch(e => e);
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.metadata?.reason).toBe('SHIFT_NOT_PENDING');
        expect((await readShift(t, s.id)).status).toBe('confirmed');
      });

      it('CAS loss: a concurrent write after the preflight wins, and nothing is overwritten', async () => {
        const s = await insertShift(t, { status: 'pending' });
        // The status flips between assertMutable's read and the CAS update.
        const racer = {
          hasTimeEntries: async () => {
            await t.d1
              .prepare("UPDATE shifts SET status = 'declined' WHERE id = ?")
              .bind(s.id)
              .run();
            return false;
          },
        };
        const err = await c.run(new ShiftRepository(racer), s.id).catch(e => e);
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.metadata?.reason).toBe('SHIFT_NOT_PENDING');
        expect((await readShift(t, s.id)).status).toBe('declined');
      });

      it('refuses when someone has clocked into the shift', async () => {
        const s = await insertShift(t, { status: 'pending' });
        await expect(
          c.run(new ShiftRepository(clockedIn), s.id)
        ).rejects.toBeInstanceOf(ShiftImmutableError);
        expect((await readShift(t, s.id)).status).toBe('pending');
      });

      it('refuses a completed/cancelled shift as immutable, and a missing one as not found', async () => {
        const done = await insertShift(t, { status: 'completed' });
        await expect(c.run(repo(), done.id)).rejects.toBeInstanceOf(
          ShiftImmutableError
        );
        const gone = await insertShift(t, {
          status: 'cancelled',
          starts_at: '2026-08-05T09:00:00.000Z',
          ends_at: '2026-08-05T17:00:00.000Z',
        });
        await expect(c.run(repo(), gone.id)).rejects.toBeInstanceOf(
          ShiftImmutableError
        );
        await expect(c.run(repo(), 'missing')).rejects.toBeInstanceOf(
          ShiftNotFoundError
        );
      });
    });
  }

  it('withdrawCoverAsk stamps the withdrawing parent, a canonical cancelled_at, and no pay', async () => {
    const s = await insertShift(t, { status: 'pending' });
    const row = await repo().withdrawCoverAsk(
      s.id,
      'parent-1',
      '2026-08-01T11:00:00+01:00'
    );
    expect(row).toMatchObject({
      status: 'cancelled',
      cancelled_by: 'parent-1',
      cancelled_at: '2026-08-01T10:00:00.000Z',
      cancellation_paid: false,
    });
  });
});

describe('ShiftRepository.listLiveForClashScan', () => {
  it('returns only carer-assigned pending/confirmed shifts overlapping the window, across households, ordered by carer', async () => {
    const a = await insertShift(t, { carer_id: 'carer-2', status: 'pending' });
    const b = await insertShift(t, { household_id: 'h2' });
    await insertShift(t, {
      carer_id: null,
      starts_at: '2026-08-05T09:00:00.000Z',
      ends_at: '2026-08-05T17:00:00.000Z',
    });
    await insertShift(t, {
      status: 'cancelled',
      starts_at: '2026-08-06T09:00:00.000Z',
      ends_at: '2026-08-06T17:00:00.000Z',
    });
    await insertShift(t, {
      status: 'completed',
      starts_at: '2026-08-07T09:00:00.000Z',
      ends_at: '2026-08-07T17:00:00.000Z',
    });
    // Outside the window.
    await insertShift(t, {
      starts_at: '2026-12-01T09:00:00.000Z',
      ends_at: '2026-12-01T17:00:00.000Z',
    });

    const rows = await repo().listLiveForClashScan(
      '2026-08-01T00:00:00Z',
      '2026-11-02T00:00:00Z'
    );
    expect(rows.map(r => r.id)).toEqual([b.id, a.id]); // carer-1 < carer-2
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        'carer_id',
        'ends_at',
        'household_id',
        'ical_uid',
        'id',
        'local_date',
        'starts_at',
      ].sort()
    );
  });

  it('returns [] when nothing is live in the window', async () => {
    expect(
      await repo().listLiveForClashScan(
        '2026-08-10T00:00:00.000Z',
        '2026-11-02T00:00:00.000Z'
      )
    ).toEqual([]);
  });
});

describe('ShiftRepository.listCancellationPaidSince', () => {
  // Feeds the reconcile job, which re-drives a PAYABLE write: a live or
  // unassigned shift must never reach it.
  it('returns only cancelled, paid, assigned shifts starting on/after `since`', async () => {
    const hit = await insertShift(t, {
      status: 'cancelled',
      cancellation_paid: true,
    });
    await insertShift(t, {
      status: 'cancelled',
      cancellation_paid: true,
      carer_id: null,
      starts_at: '2026-08-04T09:00:00.000Z',
      ends_at: '2026-08-04T17:00:00.000Z',
    });
    await insertShift(t, {
      status: 'cancelled',
      cancellation_paid: false,
      starts_at: '2026-08-05T09:00:00.000Z',
      ends_at: '2026-08-05T17:00:00.000Z',
    });
    await insertShift(t, {
      status: 'confirmed',
      cancellation_paid: true,
      starts_at: '2026-08-06T09:00:00.000Z',
      ends_at: '2026-08-06T17:00:00.000Z',
    });
    await insertShift(t, {
      status: 'cancelled',
      cancellation_paid: true,
      starts_at: '2026-07-01T09:00:00.000Z',
      ends_at: '2026-07-01T17:00:00.000Z',
    });
    const rows = await repo().listCancellationPaidSince('2026-08-03T09:00:00Z');
    expect(rows.map(r => r.id)).toEqual([hit.id]);
  });
});

describe('ShiftRepository.findExtraShiftInWindow', () => {
  const window = {
    starts_at: '2026-08-04T08:00:00.000Z',
    ends_at: '2026-08-04T12:00:00.000Z',
    local_date: '2026-08-04',
  };
  const extra = (o: Parameters<typeof insertShift>[1] = {}) =>
    insertShift(t, { kind: 'extra', status: 'pending', ...window, ...o });
  const find = (carerId: string | null = 'carer-1') =>
    repo().findExtraShiftInWindow(
      'h1',
      carerId,
      window.starts_at,
      window.ends_at
    );

  it('finds the live extra shift already covering this carer and window', async () => {
    const s = await extra();
    expect((await find())?.id).toBe(s.id);
  });

  it('matches regardless of the offset the window bounds are written in', async () => {
    const s = await extra();
    const row = await repo().findExtraShiftInWindow(
      'h1',
      'carer-1',
      '2026-08-04T09:00:00+01:00',
      '2026-08-04T12:00:00Z'
    );
    expect(row?.id).toBe(s.id);
  });

  it('ignores a cancelled shift in the same window', async () => {
    await extra({ status: 'cancelled' });
    expect(await find()).toBeNull();
  });

  it('ignores a non-extra shift in the same window', async () => {
    await extra({ kind: 'recurring' });
    expect(await find()).toBeNull();
  });

  it('matches an unassigned extra shift only via the null-carer branch', async () => {
    await extra();
    const open = await extra({ carer_id: null });
    expect((await find(null))?.id).toBe(open.id);
  });

  it('does not match another household or a different window', async () => {
    await extra({ household_id: 'h2' });
    await extra({ ends_at: '2026-08-04T13:00:00.000Z' });
    expect(await find()).toBeNull();
  });
});

describe('ShiftRepository.findParentCoverInWindow', () => {
  it('finds the live parent_cover in exactly this window, ignoring cancelled ones', async () => {
    await insertShift(t, {
      kind: 'parent_cover',
      origin: 'parent_cover',
      carer_id: null,
      status: 'cancelled',
    });
    expect(
      await repo().findParentCoverInWindow(
        'h1',
        '2026-08-03T09:00:00Z',
        '2026-08-03T17:00:00Z'
      )
    ).toBeNull();
    const live = await insertShift(t, {
      kind: 'parent_cover',
      origin: 'parent_cover',
      carer_id: null,
    });
    expect(
      (
        await repo().findParentCoverInWindow(
          'h1',
          '2026-08-03T09:00:00Z',
          '2026-08-03T17:00:00Z'
        )
      )?.id
    ).toBe(live.id);
  });
});

describe('ShiftRepository.insertChildren', () => {
  it('attaches whole-shift child rows; empty input is a no-op', async () => {
    const s = await insertShift(t);
    await repo().insertChildren(s.id, []);
    await repo().insertChildren(s.id, ['child-1', 'child-2']);
    const row = await repo().findByIdWithChildren(s.id);
    expect(row?.shift_children.map(c => c.child_id).sort()).toEqual([
      'child-1',
      'child-2',
    ]);
    expect(
      row?.shift_children.every(c => c.starts_at === null && c.ends_at === null)
    ).toBe(true);
  });

  it('is all-or-nothing: an unknown child fails the batch as a DatabaseError', async () => {
    const s = await insertShift(t);
    await expect(
      repo().insertChildren(s.id, ['child-1', 'no-such-child'])
    ).rejects.toBeInstanceOf(DatabaseError);
    expect((await repo().findByIdWithChildren(s.id))?.shift_children).toEqual(
      []
    );
  });
});

/**
 * Migration 059's partial unique index sits behind `insertExtraShift`'s
 * check-then-act guard; the race it closes is only usable if the conflict
 * arrives as a TYPED error the service can adopt the winner on.
 */
describe('ShiftRepository.createShift', () => {
  const input = {
    household_id: 'h1',
    carer_id: 'carer-1' as string | null,
    starts_at: '2026-08-04T08:00:00.000Z',
    ends_at: '2026-08-04T12:00:00.000Z',
    timezone: 'Europe/London',
    kind: 'extra' as const,
    status: 'pending' as const,
    origin: 'parent_proposed' as const,
    created_by: 'parent-1',
  };

  it('stores the row with local_date and defaults the untouched columns', async () => {
    const row = await repo().createShift(input);
    expect(row).toMatchObject({
      household_id: 'h1',
      carer_id: 'carer-1',
      kind: 'extra',
      local_date: '2026-08-04',
      source_pattern_id: null,
      is_short_notice: false,
      cancellation_paid: false,
      sequence: 0,
      note: null,
      reason: null,
      cover_ask_expires_at: null,
    });
    expect(row.ical_uid).toBeTruthy();
    expect(await readShift(t, row.id)).toMatchObject({
      local_date: '2026-08-04',
    });
  });

  it('normalises `+00:00` / offset input to toISOString form', async () => {
    const row = await repo().createShift({
      ...input,
      starts_at: '2026-08-04T08:00:00+00:00',
      ends_at: '2026-08-04T13:00:00+01:00',
      cover_ask_expires_at: '2026-08-03T20:00:00+00:00',
    });
    expect(row.starts_at).toBe('2026-08-04T08:00:00.000Z');
    expect(row.ends_at).toBe('2026-08-04T12:00:00.000Z');
    expect(row.cover_ask_expires_at).toBe('2026-08-03T20:00:00.000Z');
  });

  it('derives local_date in the household timezone, not UTC', async () => {
    const row = await repo().createShift({
      ...input,
      starts_at: '2026-08-04T23:30:00Z',
      ends_at: '2026-08-05T02:00:00Z',
    });
    expect(row.local_date).toBe('2026-08-05');
  });

  it('an exact duplicate carer-assigned extra → ExtraShiftAlreadyExistsError (overlap trigger fires first on D1)', async () => {
    await repo().createShift(input);
    const err = await repo()
      .createShift({ ...input, starts_at: '2026-08-04T09:00:00+01:00' })
      .catch(e => e);
    expect(err).toBeInstanceOf(ExtraShiftAlreadyExistsError);
    expect(err).toMatchObject({
      statusCode: 409,
      metadata: { reason: 'EXTRA_SHIFT_ALREADY_EXISTS' },
    });
  });

  it('an exact duplicate UNASSIGNED extra → ExtraShiftAlreadyExistsError (via 059’s unique index)', async () => {
    await repo().createShift({ ...input, carer_id: null });
    await expect(
      repo().createShift({ ...input, carer_id: null })
    ).rejects.toBeInstanceOf(ExtraShiftAlreadyExistsError);
  });

  it('a duplicate of a CANCELLED extra is a new shift, not a conflict', async () => {
    await insertShift(t, {
      kind: 'extra',
      status: 'cancelled',
      starts_at: input.starts_at,
      ends_at: input.ends_at,
    });
    const row = await repo().createShift(input);
    expect(row.status).toBe('pending');
  });

  it('leaves any other DB error (FK) as a DatabaseError', async () => {
    await expect(
      repo().createShift({ ...input, household_id: 'no-such-household' })
    ).rejects.toBeInstanceOf(DatabaseError);
    await expect(
      repo().createShift({ ...input, ends_at: input.starts_at })
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});

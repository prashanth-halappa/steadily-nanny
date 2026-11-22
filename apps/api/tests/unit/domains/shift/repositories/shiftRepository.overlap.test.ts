/**
 * @module tests/unit/domains/shift/repositories/shiftRepository.overlap.test
 *
 * S4a — `shifts_carer_window_excl` (migration 104; on D1 the BEFORE
 * INSERT/UPDATE trigger in migrations/0001_triggers.sql) refuses two
 * overlapping live windows for one carer inside one household. Every write
 * path that can trip it must translate that into `ShiftOverlapsError` (409)
 * rather than an opaque 500: the conflict is the caller's to resolve.
 *
 * Also the port of tests/integration/shiftOverlap.integration.test.ts: what
 * the guard must and must NOT refuse, run against the real trigger.
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
import {
  ExtraShiftAlreadyExistsError,
  ShiftOverlapsError,
} from '../../../../../src/domains/shift/errors/shiftErrors';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';
import {
  clearShifts,
  eventsFor,
  insertShift,
  readShift,
  seedWorld,
} from './seed';

let t: TestDb;
let ShiftRepository: typeof import('../../../../../src/domains/shift/repositories/shiftRepository').ShiftRepository;
const repo = () => new ShiftRepository({ hasTimeEntries: async () => false });

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  ({ ShiftRepository } = await import(
    '../../../../../src/domains/shift/repositories/shiftRepository'
  ));
  await seedWorld(t);
});

afterAll(() => t.dispose());

beforeEach(() => clearShifts(t));

/** 09:00–17:00 anchor is the seed default; this proposes a window inside it. */
const NEW_SHIFT = {
  household_id: 'h1',
  carer_id: 'carer-1' as string | null,
  starts_at: '2026-08-03T10:00:00.000Z',
  ends_at: '2026-08-03T12:00:00.000Z',
  timezone: 'Europe/London',
  kind: 'extra' as const,
  status: 'pending' as const,
  origin: 'parent_proposed' as const,
};

describe('ShiftRepository.createShift — carer window overlap', () => {
  it('translates an overlap into ShiftOverlapsError and inserts nothing', async () => {
    await insertShift(t);
    const thrown = await repo()
      .createShift(NEW_SHIFT)
      .catch(e => e);

    expect(thrown).toBeInstanceOf(ShiftOverlapsError);
    expect(thrown.statusCode).toBe(409);
    // House convention (see ConflictError): `code` is the generic 'CONFLICT'
    // and the discriminator rides in `metadata.reason`.
    expect(thrown.code).toBe('CONFLICT');
    expect(thrown.metadata).toEqual({
      reason: 'SHIFT_OVERLAP',
      householdId: 'h1',
      carerId: 'carer-1',
      startsAt: NEW_SHIFT.starts_at,
      endsAt: NEW_SHIFT.ends_at,
    });
    expect(
      await repo().findByHouseholdAndLocalDate('h1', '2026-08-03')
    ).toHaveLength(1);
  });

  it('an overlapping extra that is NOT an exact duplicate stays ShiftOverlapsError', async () => {
    await insertShift(t, { kind: 'extra', status: 'pending' });
    await expect(repo().createShift(NEW_SHIFT)).rejects.toBeInstanceOf(
      ShiftOverlapsError
    );
  });

  it('an exact-window recurring shift under a new extra is an overlap, not an "already exists"', async () => {
    await insertShift(t, {
      starts_at: NEW_SHIFT.starts_at,
      ends_at: NEW_SHIFT.ends_at,
    });
    await expect(repo().createShift(NEW_SHIFT)).rejects.toBeInstanceOf(
      ShiftOverlapsError
    );
  });

  it('an exact duplicate extra → ExtraShiftAlreadyExistsError, the adopt signal', async () => {
    await repo().createShift(NEW_SHIFT);
    await expect(repo().createShift(NEW_SHIFT)).rejects.toBeInstanceOf(
      ExtraShiftAlreadyExistsError
    );
  });

  it('a back-to-back window is ALLOWED — the range is half-open', async () => {
    await insertShift(t);
    const row = await repo().createShift({
      ...NEW_SHIFT,
      starts_at: '2026-08-03T17:00:00Z',
      ends_at: '2026-08-03T19:00:00Z',
    });
    expect(row.id).toBeTruthy();
  });

  for (const status of ['cancelled', 'declined'] as const) {
    it(`overlapping a ${status.toUpperCase()} shift is allowed — it occupies nobody`, async () => {
      await insertShift(t, { status });
      expect((await repo().createShift(NEW_SHIFT)).id).toBeTruthy();
    });
  }

  it('an unassigned (carer_id null) overlap is allowed', async () => {
    await insertShift(t, { carer_id: null });
    expect(
      (await repo().createShift({ ...NEW_SHIFT, carer_id: null })).id
    ).toBeTruthy();
  });

  it('the SAME carer overlapping in ANOTHER household is allowed — cross-household stays advisory', async () => {
    await insertShift(t, { household_id: 'h2' });
    expect((await repo().createShift(NEW_SHIFT)).id).toBeTruthy();
  });
});

describe('ShiftRepository.applyParentEdit — carer window overlap', () => {
  const edit = (shiftId: string, startsAt: string, endsAt: string) =>
    repo().applyParentEdit({
      shiftId,
      actorId: 'parent-1',
      startsAt,
      endsAt,
      note: null,
      setStartsAt: true,
      setEndsAt: true,
      setNote: false,
      origin: 'parent_proposed',
    });

  it('re-timing ONTO another of this carer’s live windows → ShiftOverlapsError; the edit rolls back with no event', async () => {
    await insertShift(t, {
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T12:00:00.000Z',
    });
    const mover = await insertShift(t, {
      kind: 'extra',
      starts_at: '2026-08-03T14:00:00.000Z',
      ends_at: '2026-08-03T16:00:00.000Z',
    });

    const thrown = await edit(
      mover.id,
      '2026-08-03T10:00:00Z',
      '2026-08-03T11:00:00Z'
    ).catch(e => e);

    expect(thrown).toBeInstanceOf(ShiftOverlapsError);
    expect(thrown.metadata).toEqual({
      reason: 'SHIFT_OVERLAP',
      shiftId: mover.id,
    });
    // Atomicity: the gated event insert ran first in the same batch and must
    // have rolled back with the failed UPDATE.
    expect(await eventsFor(t, mover.id)).toEqual([]);
    const after = await readShift(t, mover.id);
    expect(after).toMatchObject({
      starts_at: mover.starts_at,
      ends_at: mover.ends_at,
      status: 'confirmed',
      sequence: 0,
    });
  });

  it('re-timing an extra onto another extra’s exact window → ExtraShiftAlreadyExistsError', async () => {
    const target = await insertShift(t, {
      kind: 'extra',
      status: 'pending',
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T12:00:00.000Z',
    });
    const mover = await insertShift(t, {
      kind: 'extra',
      status: 'pending',
      starts_at: '2026-08-03T14:00:00.000Z',
      ends_at: '2026-08-03T16:00:00.000Z',
    });
    const thrown = await edit(mover.id, target.starts_at, target.ends_at).catch(
      e => e
    );
    expect(thrown).toBeInstanceOf(ExtraShiftAlreadyExistsError);
    expect(thrown.metadata).toMatchObject({
      reason: 'EXTRA_SHIFT_ALREADY_EXISTS',
      shiftId: mover.id,
    });
    expect(await eventsFor(t, mover.id)).toEqual([]);
  });

  it('same for UNASSIGNED extras (the trigger skips them; 059’s index refuses)', async () => {
    const target = await insertShift(t, {
      kind: 'extra',
      carer_id: null,
      status: 'pending',
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T12:00:00.000Z',
    });
    const mover = await insertShift(t, {
      kind: 'extra',
      carer_id: null,
      status: 'pending',
      starts_at: '2026-08-03T14:00:00.000Z',
      ends_at: '2026-08-03T16:00:00.000Z',
    });
    await expect(
      edit(mover.id, target.starts_at, target.ends_at)
    ).rejects.toBeInstanceOf(ExtraShiftAlreadyExistsError);
    expect(await eventsFor(t, mover.id)).toEqual([]);
  });

  it('moving a shift within its own window never overlaps itself', async () => {
    const s = await insertShift(t);
    const row = await edit(
      s.id,
      '2026-08-03T10:00:00Z',
      '2026-08-03T16:00:00Z'
    );
    expect(row.starts_at).toBe('2026-08-03T10:00:00.000Z');
  });
});

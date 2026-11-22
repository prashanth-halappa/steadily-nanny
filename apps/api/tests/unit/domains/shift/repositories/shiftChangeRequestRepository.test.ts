/** ShiftChangeRequestRepository reads + single-row CAS + sweeps, on a real D1. */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { ChangeRequestNotPendingError } from '../../../../../src/domains/shift/errors/shiftErrors';
import type { ShiftChangeRequestRepository as Repo } from '../../../../../src/domains/shift/repositories/shiftChangeRequestRepository';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';
import {
  PARENT,
  requestById,
  resetShiftTables,
  seedBase,
  seedRequest,
  seedShift,
} from './changeRequestSeed';

let t: TestDb;
let repo: Repo;
let shiftA: string;
let shiftB: string;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { ShiftChangeRequestRepository } = await import(
    '../../../../../src/domains/shift/repositories/shiftChangeRequestRepository'
  );
  repo = new ShiftChangeRequestRepository();
  await seedBase(t);
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await resetShiftTables(t);
  shiftA = await seedShift(t, {
    starts_at: '2026-06-01T08:00:00.000Z',
    ends_at: '2026-06-01T16:00:00.000Z',
  });
  shiftB = await seedShift(t, {
    starts_at: '2026-06-02T08:00:00.000Z',
    ends_at: '2026-06-02T16:00:00.000Z',
  });
});

describe('listByShift', () => {
  it('returns only that shift’s requests, newest first', async () => {
    const old = await seedRequest(t, shiftA, {
      status: 'declined',
      created_at: '2026-05-01T00:00:00.000Z',
    });
    const fresh = await seedRequest(t, shiftA, {
      created_at: '2026-05-02T00:00:00.000Z',
    });
    await seedRequest(t, shiftB);
    const rows = await repo.listByShift(shiftA);
    expect(rows.map(r => r.id)).toEqual([fresh, old]);
  });
});

describe('listPendingByShiftIds', () => {
  it('returns [] for no ids', async () => {
    expect(await repo.listPendingByShiftIds([])).toEqual([]);
  });

  it('returns only pending rows for the given shifts, newest first', async () => {
    const a = await seedRequest(t, shiftA, {
      created_at: '2026-05-01T00:00:00.000Z',
    });
    await seedRequest(t, shiftA, { status: 'withdrawn' });
    const b = await seedRequest(t, shiftB, {
      created_at: '2026-05-03T00:00:00.000Z',
    });
    const other = await seedShift(t, {
      starts_at: '2026-06-03T08:00:00.000Z',
      ends_at: '2026-06-03T16:00:00.000Z',
    });
    await seedRequest(t, other);
    const rows = await repo.listPendingByShiftIds([shiftA, shiftB]);
    expect(rows.map(r => r.id)).toEqual([b, a]);
    expect(rows.every(r => r.status === 'pending')).toBe(true);
  });
});

describe('respond', () => {
  it('writes response_message, never message, and stamps the responder', async () => {
    const id = await seedRequest(t, shiftA);
    const row = await repo.respond(id, 'declined', PARENT, 'no thanks');
    expect(row).toMatchObject({
      id,
      status: 'declined',
      responded_by: PARENT,
      response_message: 'no thanks',
      message: 'requester note',
    });
    expect(row.responded_at).toBeTruthy();
    expect(await requestById(t, id)).toMatchObject({
      status: 'declined',
      message: 'requester note',
    });
  });

  it('leaves response_message null when no message is given', async () => {
    const id = await seedRequest(t, shiftA);
    const row = await repo.respond(id, 'declined', PARENT);
    expect(row.response_message).toBeNull();
  });

  it('CAS on pending: a settled row is untouched and throws ChangeRequestNotPendingError', async () => {
    const id = await seedRequest(t, shiftA, { status: 'withdrawn' });
    await expect(repo.respond(id, 'declined', PARENT)).rejects.toBeInstanceOf(
      ChangeRequestNotPendingError
    );
    expect(await requestById(t, id)).toMatchObject({
      status: 'withdrawn',
      responded_by: null,
    });
  });

  it('throws ChangeRequestNotPendingError for a missing id', async () => {
    await expect(
      repo.respond('nope', 'declined', PARENT)
    ).rejects.toBeInstanceOf(ChangeRequestNotPendingError);
  });
});

describe('withdraw', () => {
  it('flips pending → withdrawn', async () => {
    const id = await seedRequest(t, shiftA);
    expect((await repo.withdraw(id)).status).toBe('withdrawn');
    expect((await requestById(t, id))?.status).toBe('withdrawn');
  });

  it('a second withdraw (or any settled row) throws and changes nothing', async () => {
    const id = await seedRequest(t, shiftA, { status: 'accepted' });
    await expect(repo.withdraw(id)).rejects.toBeInstanceOf(
      ChangeRequestNotPendingError
    );
    expect((await requestById(t, id))?.status).toBe('accepted');
  });
});

describe('expirePendingOlderThan', () => {
  const CUTOFF = '2026-07-30T00:00:00.000Z';

  it('flips only pending rows created before the cutoff, and returns them', async () => {
    const stale = await seedRequest(t, shiftA, {
      created_at: '2026-07-01T00:00:00.000Z',
    });
    const fresh = await seedRequest(t, shiftB, {
      created_at: '2026-07-31T00:00:00.000Z',
    });
    // Settled before the cutoff — a sweep must never reopen it as expired.
    const settled = await seedRequest(t, shiftB, {
      status: 'declined',
      created_at: '2026-07-01T00:00:00.000Z',
    });

    const rows = await repo.expirePendingOlderThan(CUTOFF);

    expect(rows.map(r => r.id)).toEqual([stale]);
    expect((await requestById(t, stale))?.status).toBe('expired');
    expect((await requestById(t, fresh))?.status).toBe('pending');
    expect((await requestById(t, settled))?.status).toBe('declined');
  });

  it('never stamps responded_by or responded_at — nobody responded', async () => {
    const id = await seedRequest(t, shiftA, {
      created_at: '2026-07-01T00:00:00.000Z',
    });
    const [row] = await repo.expirePendingOlderThan(CUTOFF);
    expect(row).toMatchObject({ id, responded_by: null, responded_at: null });
  });

  it('normalises an offset cutoff to the canonical instant', async () => {
    const id = await seedRequest(t, shiftA, {
      created_at: '2026-07-29T23:30:00.000Z',
    });
    // 01:00+01:00 is 00:00Z — the row is 30 minutes older than that.
    const rows = await repo.expirePendingOlderThan('2026-07-30T01:00:00+01:00');
    expect(rows.map(r => r.id)).toEqual([id]);
  });

  it('returns [] when nothing is stale — an empty sweep is not an error', async () => {
    await seedRequest(t, shiftA, { created_at: '2026-08-01T00:00:00.000Z' });
    await expect(repo.expirePendingOlderThan(CUTOFF)).resolves.toEqual([]);
  });
});

describe('expirePendingForStartedShifts', () => {
  it('expires pending requests whose shift has started, leaving future shifts and settled rows', async () => {
    const started = await seedRequest(t, shiftA);
    const settled = await seedRequest(t, shiftA, { status: 'declined' });
    const future = await seedRequest(t, shiftB);

    const rows = await repo.expirePendingForStartedShifts(
      '2026-06-01T08:00:00.000Z' // exactly shiftA's start: inclusive
    );

    expect(rows.map(r => r.id)).toEqual([started]);
    expect(rows[0]).toMatchObject({ responded_by: null, responded_at: null });
    expect((await requestById(t, settled))?.status).toBe('declined');
    expect((await requestById(t, future))?.status).toBe('pending');
  });

  it('returns [] when no shift has started', async () => {
    await seedRequest(t, shiftA);
    expect(
      await repo.expirePendingForStartedShifts('2026-05-01T00:00:00.000Z')
    ).toEqual([]);
  });
});

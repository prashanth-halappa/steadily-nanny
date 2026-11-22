/**
 * ShiftRepository.applyParentEdit — the TS port of `apply_parent_shift_edit`
 * (MIGRATION-NOTES §5.6), against a real Miniflare D1.
 *
 * Replaces the Postgres-SQL-text tests (027/031/034/071) with behaviour:
 * sequence is derived from the row as READ (+1), the `shift_updated` event's
 * before/after snapshots are derived (never caller-supplied), confirmed →
 * pending demotion happens ONLY on a by-value time change, `local_date`
 * follows `starts_at`, and the read-then-guarded-batch serialises concurrent
 * edits (the FOR UPDATE replacement) — ported from
 * tests/integration/shiftRpcs.integration.test.ts.
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
import { DatabaseError } from '../../../../../src/errors';
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

type EditArgs = Parameters<
  InstanceType<typeof ShiftRepository>['applyParentEdit']
>[0];

const editArgs = (shiftId: string, o: Partial<EditArgs> = {}): EditArgs => ({
  shiftId,
  actorId: 'parent-1',
  startsAt: '2026-08-03T10:00:00Z',
  endsAt: null,
  note: null,
  setStartsAt: true,
  setEndsAt: false,
  setNote: false,
  origin: 'parent_proposed',
  ...o,
});

interface Snapshot {
  starts_at: string;
  ends_at: string;
  note: string | null;
  sequence: number;
  origin: string;
  status: string;
}
interface EditPayload {
  before: Snapshot;
  after: Snapshot;
  actor_id: string;
}

async function payloads(shiftId: string): Promise<EditPayload[]> {
  const rows = await eventsFor(t, shiftId);
  expect(rows.every(r => r.event_type === 'shift_updated')).toBe(true);
  return rows
    .map(r => r.payload as unknown as EditPayload)
    .sort((a, b) => a.after.sequence - b.after.sequence);
}

const bump = (id: string) =>
  t.d1
    .prepare('UPDATE shifts SET sequence = sequence + 1 WHERE id = ?')
    .bind(id)
    .run();

describe('applyParentEdit — derived sequence and audit event', () => {
  it('derives sequence from the read row +1 and records a before/after snapshot', async () => {
    const s = await insertShift(t, { sequence: 4, note: 'old' });

    const row = await repo().applyParentEdit(editArgs(s.id));

    expect(row.sequence).toBe(5);
    expect(row.starts_at).toBe('2026-08-03T10:00:00.000Z');
    expect(row.origin).toBe('parent_proposed');
    expect(await readShift(t, s.id)).toMatchObject({
      sequence: 5,
      starts_at: '2026-08-03T10:00:00.000Z',
    });

    const events = await eventsFor(t, s.id);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({
      household_id: 'h1',
      actor_id: 'parent-1',
      event_type: 'shift_updated',
      local_date: '2026-08-03',
    });
    const payload = event?.payload as unknown as EditPayload;
    expect(Object.keys(payload).sort()).toEqual([
      'actor_id',
      'after',
      'before',
    ]);
    expect(payload.actor_id).toBe('parent-1');
    const keys = [
      'ends_at',
      'note',
      'origin',
      'sequence',
      'starts_at',
      'status',
    ];
    expect(Object.keys(payload.before).sort()).toEqual(keys);
    expect(Object.keys(payload.after).sort()).toEqual(keys);
    expect(payload.before).toEqual({
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T17:00:00.000Z',
      note: 'old',
      sequence: 4,
      origin: 'system_generated',
      status: 'confirmed',
    });
    expect(payload.after).toEqual({
      starts_at: '2026-08-03T10:00:00.000Z',
      ends_at: '2026-08-03T17:00:00.000Z',
      note: 'old',
      sequence: 5,
      origin: 'parent_proposed',
      status: 'pending',
    });
  });

  it('sets only the flagged fields: unflagged values are ignored, a flagged null note clears it', async () => {
    const s = await insertShift(t, { note: 'keep?' });
    const row = await repo().applyParentEdit(
      editArgs(s.id, {
        startsAt: '2026-08-03T06:00:00Z', // not flagged → ignored
        setStartsAt: false,
        endsAt: '2026-08-03T18:00:00+00:00',
        setEndsAt: true,
        note: null,
        setNote: true,
      })
    );
    expect(row).toMatchObject({
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T18:00:00.000Z',
      note: null,
    });
  });

  it('recomputes local_date (shift AND event) when starts_at crosses local midnight', async () => {
    const s = await insertShift(t, {
      starts_at: '2026-08-03T20:00:00.000Z',
      ends_at: '2026-08-04T02:00:00.000Z',
    });
    // 23:30Z on 3 Aug is 00:30 BST on 4 Aug.
    const row = await repo().applyParentEdit(
      editArgs(s.id, { startsAt: '2026-08-03T23:30:00Z' })
    );
    expect(row.local_date).toBe('2026-08-04');
    expect((await readShift(t, s.id)).local_date).toBe('2026-08-04');
    expect((await eventsFor(t, s.id))[0]?.local_date).toBe('2026-08-04');
  });

  it('a missing shift raises DatabaseError and writes no event', async () => {
    const err = await repo()
      .applyParentEdit(editArgs('missing'))
      .catch(e => e);
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err.metadata).toMatchObject({ shiftId: 'missing' });
    expect(await eventsFor(t, 'missing')).toEqual([]);
  });
});

describe('applyParentEdit — confirmed → pending demotion (071 value diff)', () => {
  it('a real time change demotes confirmed → pending', async () => {
    const s = await insertShift(t);
    const row = await repo().applyParentEdit(editArgs(s.id));
    expect(row.status).toBe('pending');
    expect(row.sequence).toBe(1);
  });

  it('a changed END alone also demotes', async () => {
    const s = await insertShift(t);
    const row = await repo().applyParentEdit(
      editArgs(s.id, {
        setStartsAt: false,
        endsAt: '2026-08-03T18:00:00Z',
        setEndsAt: true,
      })
    );
    expect(row.status).toBe('pending');
  });

  it('RESENDING the same instants (different offset/format) does NOT demote', async () => {
    const s = await insertShift(t);
    const row = await repo().applyParentEdit(
      editArgs(s.id, {
        startsAt: '2026-08-03T10:00:00+01:00',
        endsAt: '2026-08-03T17:00:00Z',
        setEndsAt: true,
      })
    );
    expect(row.status).toBe('confirmed');
    expect(row.starts_at).toBe('2026-08-03T09:00:00.000Z');
    // Still a recorded edit: sequence advances and the event is written.
    expect(row.sequence).toBe(1);
    const [p] = await payloads(s.id);
    expect(p?.before.status).toBe('confirmed');
    expect(p?.after.status).toBe('confirmed');
  });

  it('a note-only edit does NOT demote', async () => {
    const s = await insertShift(t);
    const row = await repo().applyParentEdit(
      editArgs(s.id, {
        startsAt: null,
        setStartsAt: false,
        note: 'bring wellies',
        setNote: true,
      })
    );
    expect(row).toMatchObject({ status: 'confirmed', note: 'bring wellies' });
  });

  it('a non-confirmed shift keeps its status on a time change', async () => {
    const s = await insertShift(t, { status: 'pending' });
    expect((await repo().applyParentEdit(editArgs(s.id))).status).toBe(
      'pending'
    );
  });
});

describe('applyParentEdit — serialisation (the FOR UPDATE replacement)', () => {
  it('a write landing between the read and the batch forces a re-read: the edit applies on top of it', async () => {
    const s = await insertShift(t, { sequence: 2 });
    const r = repo();
    const read = r.findById.bind(r);
    let reads = 0;
    r.findById = async id => {
      const row = await read(id);
      if (reads++ === 0) await bump(s.id); // concurrent writer after our read
      return row;
    };

    const row = await r.applyParentEdit(editArgs(s.id));

    expect(reads).toBe(2);
    expect(row.sequence).toBe(4); // 2 → (bumped) 3 → (ours) 4
    const ps = await payloads(s.id);
    // Exactly one event, and its before is the row as RE-read, not the stale one.
    expect(ps).toHaveLength(1);
    expect(ps[0]?.before.sequence).toBe(3);
    expect(ps[0]?.after.sequence).toBe(4);
  });

  it('gives up with DatabaseError when the shift keeps changing, leaving no event behind', async () => {
    const s = await insertShift(t);
    const r = repo();
    const read = r.findById.bind(r);
    r.findById = async id => {
      const row = await read(id);
      await bump(s.id);
      return row;
    };

    const err = await r.applyParentEdit(editArgs(s.id)).catch(e => e);

    expect(err).toBeInstanceOf(DatabaseError);
    expect(err.metadata?.details).toContain('kept changing');
    expect(await eventsFor(t, s.id)).toEqual([]);
    const after = await readShift(t, s.id);
    expect(after.starts_at).toBe(s.starts_at);
    expect(after.sequence).toBe(3); // only the three foreign bumps
  });

  it('two concurrent edits both apply: sequence ends at +2 with exactly two events chained before→after', async () => {
    const s = await insertShift(t, { sequence: 7 });
    const [a, b] = await Promise.all([
      repo().applyParentEdit(
        editArgs(s.id, { startsAt: '2026-08-03T10:00:00Z' })
      ),
      repo().applyParentEdit(
        editArgs(s.id, {
          startsAt: null,
          setStartsAt: false,
          note: 'second',
          setNote: true,
        })
      ),
    ]);

    expect([a.sequence, b.sequence].sort()).toEqual([8, 9]);
    const final = await readShift(t, s.id);
    expect(final.sequence).toBe(9);
    // Neither edit was lost: the later one was applied on top of the earlier.
    expect(final.starts_at).toBe('2026-08-03T10:00:00.000Z');
    expect(final.note).toBe('second');

    const ps = await payloads(s.id);
    expect(ps).toHaveLength(2);
    const [first, second] = ps as [EditPayload, EditPayload];
    expect(first.before.sequence).toBe(7);
    expect(first.after.sequence).toBe(8);
    // The second edit's pre-state is exactly the first edit's post-state.
    expect(second.before).toEqual(first.after);
    expect(second.after.sequence).toBe(9);
  });
});

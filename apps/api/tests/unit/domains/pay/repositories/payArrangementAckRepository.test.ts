/**
 * `create`'s one job beyond `BaseRepository`: a repeat of the same
 * (arrangement, carer, kind) ack hits the real
 * `pay_arrangement_acks_arrangement_id_carer_id_kind_key` unique and returns
 * the ORIGINAL row ("there is no un-acknowledge", spec §8.1) instead of a 500.
 *
 * @module tests/unit/domains/pay/repositories/payArrangementAckRepository
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
import { households, payArrangements } from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let PayArrangementAckRepository: any;
let DatabaseError: any;
let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  await t.db.insert(households).values({ id: 'h1', name: 'One' });
  await t.db.insert(payArrangements).values(
    ['pa-1', 'pa-2'].map(id => ({
      id,
      household_id: 'h1',
      rate_minor: 1500,
      valid_from: '2026-01-01',
      carer_display_name: 'Maria',
    }))
  );

  PayArrangementAckRepository = (
    await import(
      '../../../../../src/domains/pay/repositories/payArrangementAckRepository'
    )
  ).PayArrangementAckRepository;
  DatabaseError = (await import('../../../../../src/errors')).DatabaseError;
});
afterAll(() => t.dispose());

beforeEach(() => t.d1.prepare('DELETE FROM pay_arrangement_acks').run());

const ack = (overrides: Record<string, unknown> = {}) => ({
  arrangement_id: 'pa-1',
  carer_id: 'carer-1',
  kind: 'seen',
  note: null,
  ...overrides,
});

describe('PayArrangementAckRepository.create', () => {
  it('inserts and returns the row', async () => {
    const created = await new PayArrangementAckRepository().create(ack());
    expect(created).toMatchObject({ arrangement_id: 'pa-1', kind: 'seen' });
    expect(created.id).toBeString();
  });

  it('a repeat ack is idempotent: the ORIGINAL row comes back', async () => {
    const repo = new PayArrangementAckRepository();
    const first = await repo.create(ack());
    const again = await repo.create(ack({ note: 'twice' }));
    expect(again.id).toBe(first.id);
    expect(again.note).toBeNull();
    expect(await repo.listForArrangement('pa-1')).toHaveLength(1);
  });

  it('a different kind on the same arrangement is a new row', async () => {
    const repo = new PayArrangementAckRepository();
    const seen = await repo.create(ack());
    const disagreed = await repo.create(ack({ kind: 'disagreed' }));
    expect(disagreed.id).not.toBe(seen.id);
  });

  it('a non-unique failure is a DatabaseError', async () => {
    await expect(
      new PayArrangementAckRepository().create(ack({ kind: 'maybe' }))
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe('PayArrangementAckRepository.listForArrangement', () => {
  it('scopes to the arrangement, newest first', async () => {
    const repo = new PayArrangementAckRepository();
    await t.d1
      .prepare(
        `INSERT INTO pay_arrangement_acks (id, arrangement_id, carer_id, kind, created_at) VALUES
         ('old', 'pa-1', 'carer-1', 'seen', '2026-08-01T09:00:00.000Z'),
         ('new', 'pa-1', 'carer-1', 'disagreed', '2026-08-02T09:00:00.000Z'),
         ('other', 'pa-2', 'carer-1', 'seen', '2026-08-03T09:00:00.000Z')`
      )
      .run();
    const rows = await repo.listForArrangement('pa-1');
    expect(rows.map((r: any) => r.id)).toEqual(['new', 'old']);
  });
});

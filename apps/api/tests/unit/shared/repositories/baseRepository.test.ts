/** BaseRepository on a real Miniflare D1 (tests/helpers/testDb.ts). */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import type { InferSelectModel } from 'drizzle-orm';
import { mapDbError } from '../../../../src/db/errors';
import { households } from '../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../helpers/testDb';

type Household = InferSelectModel<typeof households>;

let t: TestDb;
let repo: {
  findById(id: string): Promise<Household | null>;
  findAll(f?: Record<string, unknown>): Promise<Household[]>;
  create(d: Partial<Household>): Promise<Household>;
  update(id: string, d: Partial<Household>): Promise<Household>;
  delete(id: string): Promise<void>;
};

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../src/db/client', () => ({ db: t.db }));
  const { BaseRepository } = await import(
    '../../../../src/shared/repositories/baseRepository'
  );
  class HouseholdRepo extends BaseRepository<Household, typeof households> {
    constructor() {
      super(households);
    }
  }
  repo = new HouseholdRepo();
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await t.d1.prepare('DELETE FROM households').run();
});

describe('BaseRepository', () => {
  test('create returns the row with app-side id and SQL defaults', async () => {
    const h = await repo.create({ name: 'Home', currency: 'GBP' });
    expect(h.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.currency).toBe('GBP');
    expect(h.timezone).toBe('Europe/London');
    expect(h.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  test('findById returns the row, or null when missing', async () => {
    const h = await repo.create({ name: 'Home' });
    expect((await repo.findById(h.id))?.name).toBe('Home');
    expect(await repo.findById('nope')).toBeNull();
  });

  test('findAll with no filters, one filter, and AND-ed filters', async () => {
    await repo.create({ name: 'A', currency: 'GBP', country: 'GB' });
    await repo.create({ name: 'B', currency: 'GBP', country: 'US' });
    await repo.create({ name: 'C', currency: 'USD' });
    expect(await repo.findAll()).toHaveLength(3);
    expect(await repo.findAll({ currency: 'GBP' })).toHaveLength(2);
    const both = await repo.findAll({ currency: 'GBP', country: 'US' });
    expect(both.map(h => h.name)).toEqual(['B']);
  });

  test('findAll on an unknown column throws DatabaseError', async () => {
    await expect(repo.findAll({ nope: 1 })).rejects.toMatchObject({
      name: 'DatabaseError',
      metadata: { operation: 'findAll' },
    });
  });

  test('update returns the updated row', async () => {
    const h = await repo.create({ name: 'Old' });
    const u = await repo.update(h.id, { name: 'New' });
    expect(u.name).toBe('New');
    expect((await repo.findById(h.id))?.name).toBe('New');
  });

  test('update of a missing id throws (supabase .single() contract)', async () => {
    await expect(repo.update('nope', { name: 'x' })).rejects.toMatchObject({
      name: 'DatabaseError',
      metadata: { id: 'nope', operation: 'update' },
    });
  });

  test('delete removes the row; deleting a missing id is a no-op', async () => {
    const h = await repo.create({ name: 'Gone' });
    await repo.delete(h.id);
    expect(await repo.findById(h.id)).toBeNull();
    await repo.delete(h.id);
  });

  test('constraint failures: DatabaseError carrying mapDbError kind and cause', async () => {
    const check = await repo.create({ currency: 'gbp' }).catch(e => e);
    expect(check.name).toBe('DatabaseError');
    expect(check.metadata).toMatchObject({
      operation: 'create',
      kind: 'check',
    });
    expect(mapDbError(check)?.kind).toBe('check');

    const fk = await repo
      .create({ name: 'x', created_by: 'no-such-user' })
      .catch(e => e);
    expect(mapDbError(fk)?.kind).toBe('foreign_key');

    const h = await repo.create({ name: 'Dup' });
    const dup = await repo.create({ id: h.id, name: 'Dup' }).catch(e => e);
    expect(mapDbError(dup)).toEqual({
      kind: 'unique',
      constraint: 'households_pkey',
    });
  });
});

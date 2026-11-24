/**
 * LegalAcceptanceRepository against a real Miniflare D1 (tests/helpers/testDb.ts):
 * idempotent insert on (user_id, version), latest-acceptance lookup scoped by
 * user, and cascade delete when the owning auth `user` row is deleted.
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
import { eq } from 'drizzle-orm';
import { legalAcceptances, user } from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let LegalAcceptanceRepository: typeof import('../../../../../src/domains/legal/repositories/legalAcceptanceRepository').LegalAcceptanceRepository;
let legalAcceptanceRepository: typeof import('../../../../../src/domains/legal/repositories/legalAcceptanceRepository').legalAcceptanceRepository;

const USER_A = 'legal-user-a';
const USER_B = 'legal-user-b';
const USER_EMPTY = 'legal-user-empty';
const USER_CASCADE = 'legal-user-cascade';

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const mod = await import(
    '../../../../../src/domains/legal/repositories/legalAcceptanceRepository'
  );
  LegalAcceptanceRepository = mod.LegalAcceptanceRepository;
  legalAcceptanceRepository = mod.legalAcceptanceRepository;

  for (const id of [USER_A, USER_B, USER_EMPTY]) {
    await t.db.insert(user).values({ id, name: id, email: `${id}@x.test` });
  }
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await t.db.delete(legalAcceptances);
});

describe('LegalAcceptanceRepository', () => {
  describe('insertIfAbsent', () => {
    it('inserts a new acceptance row and returns true', async () => {
      const repo = new LegalAcceptanceRepository();
      const inserted = await repo.insertIfAbsent({
        user_id: USER_A,
        version: '2026-11-24',
        accepted_at: '2026-11-24T10:00:00.000Z',
        ip: '203.0.113.10',
        user_agent: 'SteadilyNanny/1.2.0',
        platform: 'ios',
        app_version: '1.2.0',
      });

      expect(inserted).toBe(true);

      const rows = await t.db
        .select()
        .from(legalAcceptances)
        .where(eq(legalAcceptances.user_id, USER_A));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_id: USER_A,
        version: '2026-11-24',
        accepted_at: '2026-11-24T10:00:00.000Z',
        ip: '203.0.113.10',
        user_agent: 'SteadilyNanny/1.2.0',
        platform: 'ios',
        app_version: '1.2.0',
      });
      expect(rows[0]?.id).toBeTruthy();
      expect(rows[0]?.created_at).toMatch(
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
      );
    });

    it('returns false on duplicate (user_id, version) and preserves the original accepted_at', async () => {
      const repo = new LegalAcceptanceRepository();
      const firstAt = '2026-11-24T10:00:00.000Z';
      const secondAt = '2026-11-24T12:30:00.000Z';

      const first = await repo.insertIfAbsent({
        user_id: USER_A,
        version: '2026-11-24',
        accepted_at: firstAt,
        platform: 'ios',
      });
      const second = await repo.insertIfAbsent({
        user_id: USER_A,
        version: '2026-11-24',
        accepted_at: secondAt,
        platform: 'android',
      });

      expect(first).toBe(true);
      expect(second).toBe(false);

      const rows = await t.db
        .select()
        .from(legalAcceptances)
        .where(eq(legalAcceptances.user_id, USER_A));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.accepted_at).toBe(firstAt);
      expect(rows[0]?.platform).toBe('ios');
    });
  });

  describe('findLatestForUser', () => {
    it('returns null when the user has no acceptance rows', async () => {
      const latest =
        await legalAcceptanceRepository.findLatestForUser(USER_EMPTY);
      expect(latest).toBeNull();
    });

    it('returns the newest of two versions by accepted_at', async () => {
      const repo = new LegalAcceptanceRepository();
      await repo.insertIfAbsent({
        user_id: USER_A,
        version: '2026-01-01',
        accepted_at: '2026-01-02T08:00:00.000Z',
      });
      await repo.insertIfAbsent({
        user_id: USER_A,
        version: '2026-11-24',
        accepted_at: '2026-11-24T09:15:00.000Z',
      });

      const latest = await repo.findLatestForUser(USER_A);
      expect(latest).toEqual({
        version: '2026-11-24',
        accepted_at: '2026-11-24T09:15:00.000Z',
      });
    });

    it('does not return rows belonging to another user', async () => {
      const repo = new LegalAcceptanceRepository();
      await repo.insertIfAbsent({
        user_id: USER_B,
        version: '2026-11-24',
        accepted_at: '2026-11-24T11:00:00.000Z',
      });

      expect(await repo.findLatestForUser(USER_A)).toBeNull();
      expect(await repo.findLatestForUser(USER_B)).toEqual({
        version: '2026-11-24',
        accepted_at: '2026-11-24T11:00:00.000Z',
      });
    });
  });

  describe('cascade delete', () => {
    it('deletes acceptance rows when the auth user row is deleted', async () => {
      await t.db.insert(user).values({
        id: USER_CASCADE,
        name: USER_CASCADE,
        email: `${USER_CASCADE}@x.test`,
      });

      const repo = new LegalAcceptanceRepository();
      const inserted = await repo.insertIfAbsent({
        user_id: USER_CASCADE,
        version: '2026-11-24',
        accepted_at: '2026-11-24T10:00:00.000Z',
      });
      expect(inserted).toBe(true);

      await t.db.delete(user).where(eq(user.id, USER_CASCADE));

      const remaining = await t.db
        .select()
        .from(legalAcceptances)
        .where(eq(legalAcceptances.user_id, USER_CASCADE));
      expect(remaining).toEqual([]);
      expect(await repo.findLatestForUser(USER_CASCADE)).toBeNull();
    });
  });
});

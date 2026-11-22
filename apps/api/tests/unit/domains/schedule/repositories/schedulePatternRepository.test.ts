/** SchedulePatternRepository on a real D1 (tests/helpers/testDb.ts). */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';
import { seedHousehold, seedPattern, seedUser } from './seed';

let t: TestDb;
let repo: InstanceType<
  typeof import('../../../../../src/domains/schedule/repositories/schedulePatternRepository').SchedulePatternRepository
>;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const mod = await import(
    '../../../../../src/domains/schedule/repositories/schedulePatternRepository'
  );
  repo = new mod.SchedulePatternRepository();

  await seedUser(t, 'carer-1');
  await seedUser(t, 'carer-2');
  await seedHousehold(t, 'h1');
  await seedHousehold(t, 'h2');
  await seedPattern(t, 'p-old', 'h1', {
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await seedPattern(t, 'p-new', 'h1', {
    createdAt: '2026-03-01T00:00:00.000Z',
  });
  await seedPattern(t, 'p-c1', 'h1', {
    carerId: 'carer-1',
    status: 'accepted',
    createdAt: '2026-02-01T00:00:00.000Z',
  });
  await seedPattern(t, 'p-c2-pending', 'h1', {
    carerId: 'carer-2',
    status: 'pending',
  });
  await seedPattern(t, 'p-unassigned', 'h1', { status: 'accepted' });
  await seedPattern(t, 'p-h2', 'h2', {
    carerId: 'carer-1',
    status: 'accepted',
  });
});

afterAll(() => t.dispose());

describe('SchedulePatternRepository.listForHousehold', () => {
  it('lists patterns for a household, newest first', async () => {
    const rows = await repo.listForHousehold('h1');
    expect(rows.every(r => r.household_id === 'h1')).toBe(true);
    const ids = rows.map(r => r.id);
    expect(ids.indexOf('p-new')).toBeLessThan(ids.indexOf('p-c1'));
    expect(ids.indexOf('p-c1')).toBeLessThan(ids.indexOf('p-old'));
    // JSON / integer columns come back as JS values, same row shape as before D1.
    expect(rows[0]?.exdates).toEqual([]);
  });

  it('returns [] for a household with no patterns', async () => {
    expect(await repo.listForHousehold('nope')).toEqual([]);
  });
});

describe('SchedulePatternRepository.listAcceptedByHouseholdAndCarer', () => {
  it('matches an assigned carer’s accepted patterns in that household only', async () => {
    const rows = await repo.listAcceptedByHouseholdAndCarer('h1', 'carer-1');
    expect(rows.map(r => r.id)).toEqual(['p-c1']);
    expect(await repo.listAcceptedByHouseholdAndCarer('h1', 'carer-2')).toEqual(
      []
    );
  });

  // A null-carer pattern is a real shape (014: a parent sketching a usual
  // week during onboarding). `carer_id = NULL` would match nothing.
  it('matches an unassigned pattern with IS NULL', async () => {
    const rows = await repo.listAcceptedByHouseholdAndCarer('h1', null);
    expect(rows.map(r => r.id)).toEqual(['p-unassigned']);
  });
});

describe('SchedulePatternRepository.listAccepted', () => {
  it('lists accepted patterns across every household', async () => {
    const rows = await repo.listAccepted();
    expect(rows.map(r => r.id).sort()).toEqual(
      ['p-c1', 'p-h2', 'p-unassigned'].sort()
    );
  });
});

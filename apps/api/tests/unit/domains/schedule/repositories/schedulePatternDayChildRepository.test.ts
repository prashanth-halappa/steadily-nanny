/** SchedulePatternDayChildRepository on a real D1 (tests/helpers/testDb.ts). */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';
import { seedChild, seedHousehold, seedPattern } from './seed';

let t: TestDb;
let repo: InstanceType<
  typeof import('../../../../../src/domains/schedule/repositories/schedulePatternDayChildRepository').SchedulePatternDayChildRepository
>;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const mod = await import(
    '../../../../../src/domains/schedule/repositories/schedulePatternDayChildRepository'
  );
  repo = new mod.SchedulePatternDayChildRepository();

  await seedHousehold(t, 'h1');
  await seedChild(t, 'child-1', 'h1');
  await seedChild(t, 'child-2', 'h1');
  await seedPattern(t, 'p1', 'h1');
  for (const id of ['d1', 'd2', 'd3']) {
    await t.d1
      .prepare(
        "INSERT INTO schedule_pattern_days (id, pattern_id, weekday, start_time, end_time) VALUES (?, 'p1', ?, '08:00:00', '17:00:00')"
      )
      .bind(id, Number(id.slice(1)))
      .run();
  }
});

afterAll(() => t.dispose());

describe('SchedulePatternDayChildRepository.insertForDay', () => {
  it('inserts child rows scoped to the given pattern_day_id', async () => {
    const result = await repo.insertForDay('d1', [
      { child_id: 'child-1' },
      { child_id: 'child-2', start_time: '09:00:00', end_time: '12:00:00' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.pattern_day_id === 'd1')).toBe(true);
    expect(result.find(r => r.child_id === 'child-2')?.start_time).toBe(
      '09:00:00'
    );
  });

  it('returns [] when given no children', async () => {
    expect(await repo.insertForDay('d2', [])).toEqual([]);
  });

  it('throws a DatabaseError when a child does not exist', async () => {
    await expect(
      repo.insertForDay('d2', [{ child_id: 'nope' }])
    ).rejects.toMatchObject({ name: 'DatabaseError' });
  });
});

describe('SchedulePatternDayChildRepository.listForDays', () => {
  it('lists children for a set of pattern_day ids only', async () => {
    await repo.insertForDay('d3', [{ child_id: 'child-1' }]);
    const rows = await repo.listForDays(['d1', 'd3']);
    expect(rows.map(r => r.pattern_day_id).sort()).toEqual(['d1', 'd1', 'd3']);
  });

  it('returns [] for an empty id list', async () => {
    expect(await repo.listForDays([])).toEqual([]);
  });
});

/** SchedulePatternDayRepository on a real D1 (tests/helpers/testDb.ts). */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';
import { seedChild, seedHousehold, seedPattern } from './seed';

let t: TestDb;
let repo: InstanceType<
  typeof import('../../../../../src/domains/schedule/repositories/schedulePatternDayRepository').SchedulePatternDayRepository
>;

const count = async (sql: string) =>
  (await t.d1.prepare(sql).first<{ n: number }>())?.n;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const mod = await import(
    '../../../../../src/domains/schedule/repositories/schedulePatternDayRepository'
  );
  repo = new mod.SchedulePatternDayRepository();
  await seedHousehold(t, 'h1');
  await seedChild(t, 'child-1', 'h1');
  await seedPattern(t, 'p1', 'h1');
  await seedPattern(t, 'p2', 'h1');
});

afterAll(() => t.dispose());

describe('SchedulePatternDayRepository.replaceForPattern', () => {
  it('deletes the pattern’s existing days (cascading away old children) then inserts the new set', async () => {
    const [old] = await repo.replaceForPattern('p1', [
      { weekday: 1, start_time: '08:00:00', end_time: '17:00:00' },
    ]);
    await t.d1
      .prepare(
        "INSERT INTO schedule_pattern_day_children (id, pattern_day_id, child_id) VALUES ('c1', ?, 'child-1')"
      )
      .bind(old?.id)
      .run();
    await repo.replaceForPattern('p2', [
      { weekday: 2, start_time: '08:00:00', end_time: '17:00:00' },
    ]);

    const result = await repo.replaceForPattern('p1', [
      { weekday: 4, start_time: '08:00:00', end_time: '17:00:00' },
      { weekday: 5, start_time: '08:00:00', end_time: '12:00:00' },
    ]);

    expect(result.map(d => d.weekday)).toEqual([4, 5]);
    expect(result.every(d => d.pattern_id === 'p1')).toBe(true);
    expect((await repo.listForPattern('p1')).map(d => d.weekday)).toEqual([
      4, 5,
    ]);
    expect(
      await count('SELECT count(*) n FROM schedule_pattern_day_children')
    ).toBe(0);
    // Another pattern's days are untouched.
    expect(await repo.listForPattern('p2')).toHaveLength(1);
  });

  it('deletes existing days and returns [] without inserting when given an empty day set', async () => {
    expect(await repo.replaceForPattern('p1', [])).toEqual([]);
    expect(await repo.listForPattern('p1')).toEqual([]);
  });

  it('is all-or-nothing: a rejected day leaves the old set in place', async () => {
    await repo.replaceForPattern('p1', [
      { weekday: 1, start_time: '08:00:00', end_time: '17:00:00' },
    ]);
    await expect(
      repo.replaceForPattern('p1', [
        { weekday: 2, start_time: '17:00:00', end_time: '08:00:00' },
      ])
    ).rejects.toMatchObject({ name: 'DatabaseError' });
    expect((await repo.listForPattern('p1')).map(d => d.weekday)).toEqual([1]);
  });

  it('inserts more days than fit one statement under D1’s parameter cap', async () => {
    const days = Array.from({ length: 28 }, (_, i) => ({
      weekday: i % 7,
      start_time: `${String(6 + Math.floor(i / 7) * 3).padStart(2, '0')}:00:00`,
      end_time: `${String(8 + Math.floor(i / 7) * 3).padStart(2, '0')}:00:00`,
    }));
    expect(await repo.replaceForPattern('p1', days)).toHaveLength(28);
  });
});

describe('SchedulePatternDayRepository.listForPattern', () => {
  it('lists a pattern’s days ordered by weekday then start_time', async () => {
    await repo.replaceForPattern('p1', [
      { weekday: 4, start_time: '15:00:00', end_time: '17:00:00' },
      { weekday: 1, start_time: '08:00:00', end_time: '17:00:00' },
      { weekday: 4, start_time: '07:00:00', end_time: '13:00:00' },
    ]);
    const rows = await repo.listForPattern('p1');
    expect(rows.map(d => `${d.weekday}@${d.start_time}`)).toEqual([
      '1@08:00:00',
      '4@07:00:00',
      '4@15:00:00',
    ]);
  });
});

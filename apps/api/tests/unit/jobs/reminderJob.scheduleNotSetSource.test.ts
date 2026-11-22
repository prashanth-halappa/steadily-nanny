/**
 * `DefaultReminderCandidateSource.listScheduleNotSet` — the firing conditions
 * that live in the query rather than in the hour gate, run against a real D1
 * (tests/helpers/testDb.ts). The injected-seam behaviour is covered in
 * `reminderJob.scheduleNotSet.test.ts`.
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
import * as schema from '../../../src/db/schema';
import type { ScheduleNotSetCandidate } from '../../../src/jobs/reminderJob';
import { createTestDb, type TestDb } from '../../helpers/testDb';

const CARER_ID = 'carer-1';
const OTHER_CARER_ID = 'carer-2';
const HOUSEHOLD_ID = 'house-1';

const NOW = new Date('2026-08-05T16:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OLD = new Date(NOW.getTime() - 2 * MS_PER_DAY).toISOString();

let t: TestDb;
let listScheduleNotSet: (now: Date) => Promise<ScheduleNotSetCandidate[]>;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../src/db/client', () => ({ db: t.db }));
  const mod = await import('../../../src/jobs/reminderJob');
  const source = new mod.DefaultReminderCandidateSource();
  listScheduleNotSet = (now: Date) => source.listScheduleNotSet(now);
});
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of [
    'schedule_patterns',
    'pay_arrangements',
    'household_members',
    'households',
    'user_profiles',
    'user',
  ]) {
    await t.d1.prepare(`DELETE FROM ${table}`).run();
  }
  for (const id of [CARER_ID, OTHER_CARER_ID]) {
    await t.d1
      .prepare('INSERT INTO user (id, name, email) VALUES (?, ?, ?)')
      .bind(id, id, `${id}@x.test`)
      .run();
    await t.d1
      .prepare('INSERT INTO user_profiles (user_id) VALUES (?)')
      .bind(id)
      .run();
  }
  await t.db
    .insert(schema.households)
    .values({ id: HOUSEHOLD_ID, name: 'Home' });
});

const nanny = (
  user_id = CARER_ID,
  extra: Partial<typeof schema.householdMembers.$inferInsert> = {}
) =>
  t.db.insert(schema.householdMembers).values({
    household_id: HOUSEHOLD_ID,
    user_id,
    role: 'nanny',
    ...extra,
  });

const arrangement = (
  carer_id = CARER_ID,
  carer_display_name = 'Marisol',
  created_at = OLD
) =>
  t.db.insert(schema.payArrangements).values({
    household_id: HOUSEHOLD_ID,
    carer_id,
    carer_display_name,
    rate_minor: 1500,
    valid_from: '2026-08-01',
    created_at,
  });

const pattern = (carer_id: string | null) =>
  t.db.insert(schema.schedulePatterns).values({
    household_id: HOUSEHOLD_ID,
    carer_id,
    rrule: 'FREQ=WEEKLY',
    dtstart: '2026-08-03',
    timezone: 'UTC',
    ical_uid: crypto.randomUUID(),
  });

describe('DefaultReminderCandidateSource.listScheduleNotSet', () => {
  it('returns the pair when every condition holds', async () => {
    await nanny();
    await arrangement();

    expect(await listScheduleNotSet(NOW)).toEqual([
      {
        household_id: HOUSEHOLD_ID,
        carer_id: CARER_ID,
        carer_display_name: 'Marisol',
      },
    ]);
  });

  it('ignores non-active nannies, non-nannies and non-live households', async () => {
    await nanny(CARER_ID, { status: 'removed' });
    await t.db.insert(schema.householdMembers).values({
      household_id: HOUSEHOLD_ID,
      user_id: OTHER_CARER_ID,
      role: 'parent',
    });
    await arrangement();
    await arrangement(OTHER_CARER_ID);
    expect(await listScheduleNotSet(NOW)).toEqual([]);

    await t.d1.prepare("UPDATE household_members SET status = 'active'").run();
    await t.d1.prepare("UPDATE households SET state = 'draft'").run();
    expect(await listScheduleNotSet(NOW)).toEqual([]);
  });

  it('yields nothing when the household has no active nanny', async () => {
    await arrangement();
    expect(await listScheduleNotSet(NOW)).toEqual([]);
  });

  it('yields nothing when no arrangement exists for the pair', async () => {
    await nanny();
    expect(await listScheduleNotSet(NOW)).toEqual([]);
  });

  // Terms are often agreed the same day the family already talked the
  // schedule through out loud — day 0 is not a stall.
  it('ignores arrangements younger than a day', async () => {
    await nanny();
    await arrangement(
      CARER_ID,
      'Marisol',
      new Date(NOW.getTime() - MS_PER_DAY + 60_000).toISOString()
    );
    expect(await listScheduleNotSet(NOW)).toEqual([]);
  });

  // STARTING the builder proves she found it, so any pattern row suppresses
  // this forever, `draft` (the default status) included.
  it('suppresses forever once a pattern exists for the pair', async () => {
    await nanny();
    await arrangement();
    await pattern(CARER_ID);
    expect(await listScheduleNotSet(NOW)).toEqual([]);
  });

  // 014's column comment: an unassigned sketch still proves the builder was
  // found, so it suppresses every carer in that household.
  it('treats an unassigned household pattern as proof the builder was found', async () => {
    await nanny();
    await arrangement();
    await pattern(null);
    expect(await listScheduleNotSet(NOW)).toEqual([]);
  });

  it('does not let one carer’s pattern suppress a second carer', async () => {
    await nanny();
    await nanny(OTHER_CARER_ID);
    await arrangement();
    await arrangement(OTHER_CARER_ID, 'Ada');
    await pattern(CARER_ID);

    expect(await listScheduleNotSet(NOW)).toEqual([
      {
        household_id: HOUSEHOLD_ID,
        carer_id: OTHER_CARER_ID,
        carer_display_name: 'Ada',
      },
    ]);
  });

  // Same precedence `resolveCarerDisplayName` uses in the pay domain.
  it('prefers the household display-name override over the stored name', async () => {
    await nanny(CARER_ID, { display_name_override: 'Mari' });
    await arrangement();
    expect((await listScheduleNotSet(NOW))[0]?.carer_display_name).toBe('Mari');
  });
});

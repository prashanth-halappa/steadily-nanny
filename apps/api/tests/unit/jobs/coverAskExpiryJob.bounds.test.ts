/**
 * F6 — `DefaultCoverAskExpirySource` must not reach back to the beginning of
 * time. The `starts_at <= now` arm matches every pending extra/cover shift
 * ever created, including pre-088 rows with a null deadline whose start is
 * months past; unbounded, the first tick after 088 ships pushes "Nobody is
 * booked for the ..." to every parent about all of them.
 *
 * Runs against the real D1 test database so the floor, the two-arm OR, the
 * ordering and the cap are exercised through the actual SQL.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { households, shifts, user, userProfiles } from '../../../src/db/schema';
import { createTestDb, type TestDb } from '../../helpers/testDb';

let t: TestDb;
let source: { listDueAsks: (now: Date) => Promise<Array<{ id: string }>> };
let EXPIRY_BATCH_LIMIT: number;
let EXPIRY_LOOKBACK_MS: number;

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) =>
  new Date(NOW.getTime() + offsetMs).toISOString();

let seq = 0;
async function seedShift(
  id: string,
  startsOffsetMs: number,
  deadlineOffsetMs: number | null,
  status = 'pending'
) {
  seq++;
  await t.db.insert(shifts).values({
    id,
    household_id: 'h1',
    carer_id: 'u1',
    starts_at: iso(startsOffsetMs),
    ends_at: iso(startsOffsetMs + 500),
    timezone: 'UTC',
    local_date: '2026-06-15',
    kind: 'extra',
    status,
    ical_uid: `ical-${seq}`,
    cover_ask_expires_at:
      deadlineOffsetMs === null ? null : iso(deadlineOffsetMs),
  });
}

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../src/db/client', () => ({ db: t.db }));
  const mod = await import('../../../src/jobs/coverAskExpiryJob');
  EXPIRY_BATCH_LIMIT = mod.EXPIRY_BATCH_LIMIT;
  EXPIRY_LOOKBACK_MS = mod.EXPIRY_LOOKBACK_MS;
  source = new mod.DefaultCoverAskExpirySource();

  await t.db
    .insert(user)
    .values({ id: 'u1', name: 'Carer', email: 'c@example.com' });
  await t.db.insert(userProfiles).values({ user_id: 'u1' });
  await t.db.insert(households).values({ id: 'h1', name: 'Home' });
});
afterAll(() => t.dispose());

describe('DefaultCoverAskExpirySource — the sweep has a floor and a ceiling', () => {
  it('floors how far back it reaches, and returns oldest first', async () => {
    // Older than the floor: excluded even though the shift has started.
    await seedShift('ancient', -EXPIRY_LOOKBACK_MS - HOUR, null);
    // Null deadline, started 2h ago: included (second OR arm).
    await seedShift('legacy-started', -2 * HOUR, null);
    // Started 3h ago, deadline passed: included, and older than the above.
    await seedShift('lapsed', -3 * HOUR, -4 * HOUR);
    // Future shift, deadline still ahead: excluded.
    await seedShift('live', 5 * HOUR, 4 * HOUR);
    // Future shift, deadline already passed: included.
    await seedShift('deadline-passed', 6 * HOUR, -HOUR);
    // Not pending: excluded.
    await seedShift('accepted', -2 * HOUR + 1000, null, 'confirmed');

    const due = await source.listDueAsks(NOW);
    expect(due.map(a => a.id)).toEqual([
      'lapsed',
      'legacy-started',
      'deadline-passed',
    ]);
  });

  it('caps the batch', async () => {
    await t.d1.prepare('DELETE FROM shifts').run();
    for (let i = 0; i < EXPIRY_BATCH_LIMIT + 5; i++) {
      await seedShift(`s${i}`, -HOUR - i * 1000, null);
    }
    const due = await source.listDueAsks(NOW);
    expect(due).toHaveLength(EXPIRY_BATCH_LIMIT);
  });
});

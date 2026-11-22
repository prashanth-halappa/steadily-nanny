/** BusyBlockRepository — the v_busy_blocks union, on a real D1 (testDb). */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let repo: any;
const CARER = 'carer-1';
const OTHER = 'carer-2';
const HH = 'household-A';
const FROM = '2026-08-01T00:00:00.000Z';
const TO = '2026-08-08T00:00:00.000Z';

async function run(sql: string, ...args: unknown[]) {
  await t.d1
    .prepare(sql)
    .bind(...args)
    .run();
}

async function shift(
  id: string,
  carer: string,
  starts: string,
  ends: string,
  status = 'confirmed'
) {
  await run(
    `INSERT INTO shifts (id, household_id, carer_id, starts_at, ends_at, timezone, local_date, status, ical_uid, note)
     VALUES (?, ?, ?, ?, ?, 'Europe/London', ?, ?, ?, 'Dentist run for the Reyes kids')`,
    id,
    HH,
    carer,
    starts,
    ends,
    starts.slice(0, 10),
    status,
    `${id}@steadily`
  );
}

const byStart = (a: { starts_at: string }, b: { starts_at: string }) =>
  a.starts_at.localeCompare(b.starts_at);

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { BusyBlockRepository } = await import(
    '../../../../../src/domains/availability/repositories/busyBlockRepository'
  );
  repo = new BusyBlockRepository();
  for (const u of [CARER, OTHER]) {
    await run(
      'INSERT INTO user (id, name, email) VALUES (?, ?, ?)',
      u,
      u,
      `${u}@x.test`
    );
    await run('INSERT INTO user_profiles (user_id) VALUES (?)', u);
  }
  await run("INSERT INTO households (id, name) VALUES (?, 'A')", HH);
});

afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ['shifts', 'carer_time_off', 'external_busy_blocks'])
    await run(`DELETE FROM ${table}`);
});

describe('BusyBlockRepository.listForCarer', () => {
  it('unions live shifts, non-cancelled time off and non-free busy blocks — for this carer only', async () => {
    await shift(
      's-confirmed',
      CARER,
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T13:00:00.000Z'
    );
    await shift(
      's-pending',
      CARER,
      '2026-08-04T09:00:00.000Z',
      '2026-08-04T13:00:00.000Z',
      'pending'
    );
    await shift(
      's-cancelled',
      CARER,
      '2026-08-05T09:00:00.000Z',
      '2026-08-05T13:00:00.000Z',
      'cancelled'
    );
    await shift(
      's-other',
      OTHER,
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T13:00:00.000Z'
    );
    await run(
      `INSERT INTO carer_time_off (id, user_id, starts_at, ends_at, status, ical_uid) VALUES
       ('t1', ?, '2026-08-06T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 'confirmed', 'to-1'),
       ('t2', ?, '2026-08-06T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 'cancelled', 'to-2')`,
      CARER,
      CARER
    );
    await run(
      `INSERT INTO external_busy_blocks (id, user_id, starts_at, ends_at, opacity, external_event_id) VALUES
       ('b1', ?, '2026-08-02T10:00:00.000Z', '2026-08-02T11:00:00.000Z', 'busy', 'ext-1'),
       ('b2', ?, '2026-08-02T12:00:00.000Z', '2026-08-02T13:00:00.000Z', 'free', 'ext-2')`,
      CARER,
      CARER
    );

    const result = await repo.listForCarer(CARER, FROM, TO);
    expect([...result].sort(byStart)).toEqual([
      {
        starts_at: '2026-08-02T10:00:00.000Z',
        ends_at: '2026-08-02T11:00:00.000Z',
        kind: 'personal',
      },
      {
        starts_at: '2026-08-03T09:00:00.000Z',
        ends_at: '2026-08-03T13:00:00.000Z',
        kind: 'other_commitment',
      },
      {
        starts_at: '2026-08-04T09:00:00.000Z',
        ends_at: '2026-08-04T13:00:00.000Z',
        kind: 'other_commitment',
      },
      {
        starts_at: '2026-08-06T00:00:00.000Z',
        ends_at: '2026-08-07T00:00:00.000Z',
        kind: 'time_off',
      },
    ]);
  });

  it('includes partial overlaps and excludes touching blocks (strict), even with ms-less bounds', async () => {
    await shift(
      's-partial',
      CARER,
      '2026-07-31T22:00:00.000Z',
      '2026-08-01T02:00:00.000Z'
    );
    // A different table: two shifts of one carer may not overlap each other.
    await run(
      `INSERT INTO external_busy_blocks (id, user_id, starts_at, ends_at) VALUES
       ('b-touch-start', ?, '2026-07-31T20:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
      CARER
    );
    await shift(
      's-touch-end',
      CARER,
      '2026-08-08T00:00:00.000Z',
      '2026-08-08T04:00:00.000Z'
    );

    const result = await repo.listForCarer(
      CARER,
      '2026-08-01T00:00:00Z',
      '2026-08-08T00:00:00Z'
    );
    expect(result.map((b: { starts_at: string }) => b.starts_at)).toEqual([
      '2026-07-31T22:00:00.000Z',
    ]);
  });

  it('returns [] when there are no blocks in the window', async () => {
    expect(await repo.listForCarer(CARER, FROM, TO)).toEqual([]);
  });

  // --- THE privacy-shape test -----------------------------------------------
  // "Keep families apart" is a product privacy promise, not a nicety: this is
  // the ONLY code path that reads a carer's cross-household busy time, so its
  // output shape is the entire enforcement mechanism. The source shift row
  // carries household_id, carer_id and a note naming another family; none of
  // that, nor the opaque source_uid, may leave this function.
  it('returns ONLY {starts_at, ends_at, kind} — never a household/user/note field', async () => {
    await shift(
      's-secret',
      CARER,
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T13:00:00.000Z'
    );
    const [block] = await repo.listForCarer(CARER, FROM, TO);
    expect(Object.keys(block).sort()).toEqual(['ends_at', 'kind', 'starts_at']);
    expect(block).toEqual({
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T13:00:00.000Z',
      kind: 'other_commitment',
    });
  });
});

describe('BusyBlockRepository.listForClashEvaluation', () => {
  it('adds opaque source_uid (ical_uid / external_event_id, "" when null) and nothing household-identifying', async () => {
    await shift(
      's1',
      CARER,
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T13:00:00.000Z'
    );
    await run(
      `INSERT INTO external_busy_blocks (id, user_id, starts_at, ends_at, opacity) VALUES
       ('b1', ?, '2026-08-02T10:00:00.000Z', '2026-08-02T11:00:00.000Z', 'tentative')`,
      CARER
    );
    const result = await repo.listForClashEvaluation(CARER, FROM, TO);
    expect([...result].sort(byStart)).toEqual([
      {
        starts_at: '2026-08-02T10:00:00.000Z',
        ends_at: '2026-08-02T11:00:00.000Z',
        kind: 'personal',
        source_uid: '',
      },
      {
        starts_at: '2026-08-03T09:00:00.000Z',
        ends_at: '2026-08-03T13:00:00.000Z',
        kind: 'other_commitment',
        source_uid: 's1@steadily',
      },
    ]);
  });
});

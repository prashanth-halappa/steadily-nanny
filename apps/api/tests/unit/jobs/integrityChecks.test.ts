/**
 * The nine integrity checks against a real D1 (Miniflare). One violating row
 * per check; a few of them are normally blocked by CHECKs / unique indexes /
 * triggers, so those are dropped on this throwaway database to seed the row.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { createTestDb, type TestDb } from '../../helpers/testDb';

let t: TestDb;
let runIntegrityChecks: typeof import('../../../src/jobs/integrityChecks').runIntegrityChecks;
let isoWeekStart: typeof import('../../../src/jobs/integrityChecks').isoWeekStart;

const NOW = new Date('2026-06-10T12:00:00.000Z');
const run = (sql: string, ...binds: unknown[]) =>
  t.d1
    .prepare(sql)
    .bind(...binds)
    .run();

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../src/db/client', () => ({ db: t.db }));
  ({ runIntegrityChecks, isoWeekStart } = await import(
    '../../../src/jobs/integrityChecks'
  ));

  await t.d1.batch(
    [
      'DROP TRIGGER IF EXISTS time_entries_no_clock_overlap_per_carer_insert',
      'DROP TRIGGER IF EXISTS time_entries_no_overlap_per_household_insert',
      'DROP INDEX IF EXISTS expenses_one_pending_claim_idx',
      'DROP INDEX IF EXISTS time_entries_one_running_per_carer',
    ].map(s => t.d1.prepare(s))
  );

  for (const u of ['c1', 'c9', 'u1', 'u2']) {
    await run(
      `INSERT INTO user (id, name, email) VALUES (?, ?, ?)`,
      u,
      u,
      `${u}@x.test`
    );
    await run(`INSERT INTO user_profiles (user_id) VALUES (?)`, u);
  }
  await run(
    `INSERT INTO carer_time_off (id, user_id, ical_uid, starts_at, ends_at) VALUES ('to1','c1','ical1','2026-06-01T00:00:00.000Z','2026-06-02T00:00:00.000Z')`
  );

  const hh = (id: string) =>
    run(
      `INSERT INTO households (id, name, timezone, currency) VALUES (?, ?, 'UTC', 'GBP')`,
      id,
      id
    );
  await hh('h1');
  await hh('h2');
  await hh('h3');
  await run(
    `INSERT INTO household_members (id, household_id, user_id, role, status) VALUES ('m1','h3','u1','nanny','active')`
  );
  await run(`INSERT INTO household_members (id, household_id, user_id, role, status)
             VALUES ('m2','h2','u2','owner','active')`);

  const entry = (
    id: string,
    inAt: string | null,
    outAt: string | null,
    extra = ''
  ) =>
    run(
      `INSERT INTO time_entries (id, household_id, carer_id, clock_in_at, clock_out_at, local_date, timezone, carer_display_name, status${extra ? ', kind, shift_id' : ''})
       VALUES (?, 'h1', 'c1', ?, ?, ?, 'UTC', 'C', ?${extra ? ", 'cancellation_paid', ?" : ''})`,
      ...[
        id,
        inAt,
        outAt,
        (inAt ?? '2026-06-01').slice(0, 10),
        inAt && !outAt ? 'running' : 'submitted',
        ...(extra ? [extra] : []),
      ]
    );
  // overlap pair + orphan week (no timesheet for that week)
  await entry('e1', '2026-05-04T09:00:00.000Z', '2026-05-04T11:00:00.000Z');
  await entry('e2', '2026-05-04T10:00:00.000Z', '2026-05-04T12:00:00.000Z');
  // stuck runner (>20h)
  await entry('e3', '2026-06-08T09:00:00.000Z', null);

  // timesheet whose stored total disagrees (week of 2026-06-08 has e3 only: no clocks out => 0)
  await run(`INSERT INTO timesheets (id, household_id, carer_id, week_start, total_minutes, carer_display_name, status, earnings)
             VALUES ('ts1','h1','c1','2026-06-08',999,'C','open','{"status":"ok"}')`);
  // earnings ok, gross missing, approved: needs the snapshot CHECK off, so rebuild is avoided
  // by using a non-approved row for the second arm of the check below.

  await run(
    `INSERT INTO pto_ledger (id, household_id, carer_id, kind, minutes, effective_date, time_off_id, carer_display_name)
     VALUES ('p1','h1','c1','usage',60,'2026-06-01','to1','C')`
  );
  for (const id of ['x1', 'x2'])
    await run(
      `INSERT INTO expenses (id, household_id, carer_id, local_date, kind, description, amount_minor, carer_display_name)
       VALUES (?, 'h1', 'c1', '2026-06-01', 'expense', 'Bus', 500, 'C')`,
      id
    );
  await run(
    `INSERT INTO shifts (id, ical_uid, household_id, carer_id, starts_at, ends_at, status, cancellation_paid, cancelled_at, timezone, local_date)
     VALUES ('s1','ical-s1','h1','c1','2026-06-09T08:00:00.000Z','2026-06-09T16:00:00.000Z','cancelled',1,'2026-06-09T09:00:00.000Z','UTC','2026-06-09')`
  );
});
afterAll(() => t.dispose());

describe('isoWeekStart', () => {
  it('returns the Monday, including for a Sunday', () => {
    expect(isoWeekStart('2026-06-10')).toBe('2026-06-08');
    expect(isoWeekStart('2026-06-14')).toBe('2026-06-08');
    expect(isoWeekStart('2026-06-08')).toBe('2026-06-08');
  });
});

describe('runIntegrityChecks', () => {
  it('flags one violation per seeded check', async () => {
    const rows = await runIntegrityChecks(NOW);
    const names = new Set(rows.map(r => r.check_name));
    for (const expected of [
      'timesheet_total_mismatch',
      'pto_net_negative',
      'expense_pending_dup',
      'cancellation_unsettled',
      'entry_overlap',
      'stuck_runner',
      'orphan_week',
      'household_ownerless',
    ])
      expect(names).toContain(expected);

    const by = (n: string) => rows.filter(r => r.check_name === n);
    expect(by('timesheet_total_mismatch')[0]?.details).toMatchObject({
      stored_minutes: 999,
      derived_minutes: 0,
    });
    expect(by('pto_net_negative')[0]).toMatchObject({
      entity_id: 'to1',
      details: { net_paid_minutes: -60, ledger_rows: 1 },
    });
    expect(by('expense_pending_dup')[0]).toMatchObject({
      entity_id: 'x1',
      details: { duplicate_count: 2 },
    });
    expect(by('entry_overlap')[0]).toMatchObject({
      entity_id: 'e1',
      details: { other_entry_id: 'e2', rule: 'per_household' },
    });
    expect(by('orphan_week')[0]?.details).toMatchObject({
      week_start: '2026-05-04',
      entry_count: 2,
      derived_minutes: 240,
    });
    expect(by('household_ownerless')).toEqual([
      expect.objectContaining({
        entity_id: 'h3',
        details: { active_member_count: 1, roles: ['nanny'] },
      }),
    ]);
  });

  it('flags an approved timesheet with earnings ok but no gross', async () => {
    await run('PRAGMA ignore_check_constraints = ON');
    await run(`INSERT INTO timesheets (id, household_id, carer_id, week_start, total_minutes, carer_display_name, status, earnings)
               VALUES ('ts2','h2','c9','2026-06-01',0,'C','approved','{"status":"ok"}')`);
    await run('PRAGMA ignore_check_constraints = OFF');
    const rows = await runIntegrityChecks(NOW);
    expect(
      rows.filter(r => r.check_name === 'approved_snapshot_mismatch')
    ).toEqual([
      expect.objectContaining({
        entity_id: 'ts2',
        details: expect.objectContaining({
          has_gross: false,
          earnings_status: 'ok',
        }),
      }),
    ]);
  });

  it('settles a cancellation once a cancellation_paid entry exists', async () => {
    await run(
      `INSERT INTO time_entries (id, household_id, carer_id, shift_id, kind, clock_in_at, clock_out_at, local_date, timezone, carer_display_name, status, scheduled_minutes)
       VALUES ('e9','h1','c1','s1','cancellation_paid','2026-06-09T08:00:00.000Z','2026-06-09T16:00:00.000Z','2026-06-09','UTC','C','approved',480)`
    );
    const rows = await runIntegrityChecks(NOW);
    expect(rows.some(r => r.check_name === 'cancellation_unsettled')).toBe(
      false
    );
  });
});

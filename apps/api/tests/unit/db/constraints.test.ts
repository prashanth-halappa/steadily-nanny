/**
 * Behaviour tests on real D1 (Miniflare) for baseline constraints that had
 * only Postgres integration coverage: the approved-timesheet snapshot CHECK,
 * the one-accepted-pattern partial index, the cover window unique indexes
 * (nulls-not-distinct via quote(carer_id)) and the pattern-day unique index.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { mapDbError } from '../../../src/db/errors';
import { createTestDb, type TestDb } from '../../helpers/testDb';

let t: TestDb;
let TimesheetRepository: typeof import('../../../src/domains/timesheet/repositories/timesheetRepository').TimesheetRepository;

const H = 'h1';
const CARER = 'u-carer';
const CARER2 = 'u-carer2';
const PARENT = 'u-parent';

const run = (q: string, ...args: unknown[]) =>
  t.d1
    .prepare(q)
    .bind(...args)
    .run();

async function refused(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return mapDbError(e);
  }
  throw new Error('expected the write to be refused');
}

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../src/db/client', () => ({ db: t.db }));
  ({ TimesheetRepository } = await import(
    '../../../src/domains/timesheet/repositories/timesheetRepository'
  ));
  for (const id of [CARER, CARER2, PARENT]) {
    await run(
      'INSERT INTO user (id, name, email) VALUES (?, ?, ?)',
      id,
      id,
      `${id}@x.test`
    );
    await run('INSERT INTO user_profiles (user_id) VALUES (?)', id);
  }
  await run(
    "INSERT INTO households (id, name, currency, country) VALUES (?, 'Home', 'GBP', 'GB')",
    H
  );
});
afterAll(() => t.dispose());

let n = 0;
const id = (p: string) => `${p}${++n}`;

describe('timesheets_approved_has_snapshot', () => {
  const SNAP = {
    gross_minor: 80_000,
    currency: 'GBP',
    earnings: '{"worked_minutes":2460}',
    earnings_computed_at: '2026-08-10T18:00:00.000Z',
  };
  type Snap = { [K in keyof typeof SNAP]: (typeof SNAP)[K] | null };
  let week = 0;
  const insert = (status: string, s: Partial<Snap> = {}) => {
    const v = { ...SNAP, ...s };
    const rowId = id('ts');
    const monday = new Date(Date.UTC(2025, 0, 6 + 7 * week++))
      .toISOString()
      .slice(0, 10);
    return {
      rowId,
      p: run(
        `INSERT INTO timesheets (id, household_id, carer_id, carer_display_name, week_start, total_minutes, status, approved_by, approved_at, household_member_id, gross_minor, currency, earnings, earnings_computed_at)
         VALUES (?, ?, ?, 'Carer', ?, 2460, ?, ?, ?, 'm1', ?, ?, ?, ?)`,
        rowId,
        H,
        CARER,
        monday,
        status,
        status === 'approved' ? PARENT : null,
        status === 'approved' ? SNAP.earnings_computed_at : null,
        v.gross_minor,
        v.currency,
        v.earnings,
        v.earnings_computed_at
      ),
    };
  };
  const NONE: Snap = {
    gross_minor: null,
    currency: null,
    earnings: null,
    earnings_computed_at: null,
  };

  for (const col of Object.keys(SNAP) as (keyof Snap)[]) {
    test(`approved with NULL ${col} is refused`, async () => {
      expect(await refused(insert('approved', { [col]: null }).p)).toEqual({
        kind: 'check',
        constraint: 'timesheets_approved_has_snapshot',
      });
    });
  }

  test('approved with the full snapshot is accepted', async () => {
    await insert('approved').p;
  });

  test('submitted with no snapshot is accepted', async () => {
    await insert('submitted', NONE).p;
  });

  test('clearing a snapshot column on an approved row is refused', async () => {
    const { rowId, p } = insert('approved');
    await p;
    expect(
      await refused(
        run('UPDATE timesheets SET earnings = NULL WHERE id = ?', rowId)
      )
    ).toMatchObject({ constraint: 'timesheets_approved_has_snapshot' });
  });

  test('promoting a bare submitted row to approved is refused', async () => {
    const { rowId, p } = insert('submitted', NONE);
    await p;
    expect(
      await refused(
        run("UPDATE timesheets SET status = 'approved' WHERE id = ?", rowId)
      )
    ).toMatchObject({ constraint: 'timesheets_approved_has_snapshot' });
  });

  test('an unpaid roll-up (previous_approval receipt) still satisfies the CHECK', async () => {
    const { rowId, p } = insert('approved');
    await p;
    const row = await new TimesheetRepository().rollUpHours(rowId, 2940);
    expect(row).toMatchObject({ status: 'submitted', gross_minor: null });
    expect(row.previous_approval).toMatchObject({ gross_minor: 80_000 });
  });
});

describe('schedule_patterns_one_accepted_idx', () => {
  const pattern = (status: string, carer: string | null, household = H) =>
    run(
      `INSERT INTO schedule_patterns (id, household_id, carer_id, status, rrule, dtstart, timezone, ical_uid)
       VALUES (?, ?, ?, ?, 'FREQ=WEEKLY', '2026-01-05', 'Europe/London', ?)`,
      id('p'),
      household,
      carer,
      status,
      id('ical-p')
    );

  test('a second accepted pattern for the same carer is refused', async () => {
    await pattern('accepted', CARER);
    expect(await refused(pattern('accepted', CARER))).toEqual({
      kind: 'unique',
      constraint: 'schedule_patterns_one_accepted_idx',
    });
  });

  test('another carer, pending patterns and carer-less patterns are allowed', async () => {
    await pattern('accepted', CARER2);
    await pattern('pending', CARER);
    await pattern('pending', CARER);
    await pattern('accepted', null);
    await pattern('accepted', null);
  });
});

describe('cover window unique indexes', () => {
  const shift = (
    kind: string,
    carer: string | null,
    status = 'confirmed',
    startsAt = '2026-03-02T08:00:00.000Z'
  ) => {
    const rowId = id('s');
    return {
      rowId,
      p: run(
        `INSERT INTO shifts (id, household_id, carer_id, starts_at, ends_at, timezone, local_date, ical_uid, status, kind)
         VALUES (?, ?, ?, ?, ?, 'Europe/London', substr(?, 1, 10), ?, ?, ?)`,
        rowId,
        H,
        carer,
        startsAt,
        startsAt.replace('T08', 'T12'),
        startsAt,
        `ical-${rowId}`,
        status,
        kind
      ),
    };
  };

  for (const [kind, name, day] of [
    ['cover', 'shifts_cover_window_unique', '10'],
    ['parent_cover', 'shifts_parent_cover_window_unique', '20'],
  ] as const) {
    const at = `2026-04-${day}T08:00:00.000Z`;

    test(`${kind}: duplicate NULL-carer window is refused`, async () => {
      await shift(kind, null, 'confirmed', at).p;
      expect(await refused(shift(kind, null, 'confirmed', at).p)).toEqual({
        kind: 'unique',
        constraint: name,
      });
    });

    test(`${kind}: duplicate carer window is refused`, async () => {
      // 'declined' skips the overlap trigger, so the unique index is what refuses.
      const later = at.replace(`-${day}T`, `-${Number(day) + 1}T`);
      await shift(kind, CARER, 'declined', later).p;
      expect(await refused(shift(kind, CARER, 'declined', later).p)).toEqual({
        kind: 'unique',
        constraint: name,
      });
    });

    test(`${kind}: a cancelled cover can be replaced at the same window`, async () => {
      const later = at.replace(`-${day}T`, `-${Number(day) + 2}T`);
      const first = shift(kind, null, 'confirmed', later);
      await first.p;
      await run(
        "UPDATE shifts SET status = 'cancelled' WHERE id = ?",
        first.rowId
      );
      await shift(kind, null, 'confirmed', later).p;
    });
  }
});

describe('schedule_pattern_days_pattern_weekday_start_idx', () => {
  test('duplicate (pattern, weekday, start_time) is refused', async () => {
    await run(
      `INSERT INTO schedule_patterns (id, household_id, carer_id, status, rrule, dtstart, timezone, ical_uid)
       VALUES ('pd-p', ?, NULL, 'draft', 'FREQ=WEEKLY', '2026-01-05', 'Europe/London', 'ical-pd-p')`,
      H
    );
    const day = (start: string, end: string, weekday = 1) =>
      run(
        `INSERT INTO schedule_pattern_days (id, pattern_id, weekday, start_time, end_time)
         VALUES (?, 'pd-p', ?, ?, ?)`,
        id('pd'),
        weekday,
        start,
        end
      );
    await day('08:00', '12:00');
    await day('13:00', '17:00');
    await day('08:00', '12:00', 2);
    expect(await refused(day('08:00', '18:00'))).toEqual({
      kind: 'unique',
      constraint: 'schedule_pattern_days_pattern_weekday_start_idx',
    });
  });
});

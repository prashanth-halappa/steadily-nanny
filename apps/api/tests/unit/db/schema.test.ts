/**
 * The D1 baseline + trigger migrations, applied to an in-memory bun:sqlite DB.
 * Behaviour tests for what the Postgres EXCLUDE constraints, triggers and FKs
 * used to guarantee, plus mapDbError over real SQLite errors.
 */
import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { mapDbError } from '../../../src/db/errors';
import * as schema from '../../../src/db/schema';

const MIGRATIONS = join(import.meta.dir, '../../../migrations');

function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .sort()) {
    for (const stmt of readFileSync(join(MIGRATIONS, f), 'utf8').split(
      '--> statement-breakpoint'
    )) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
  return db;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
}

const H = 'h1';
const CARER = 'u-carer';
const PARENT = 'u-parent';

function seed(db: Database) {
  for (const id of [CARER, PARENT]) {
    db.run('INSERT INTO user (id, name, email) VALUES (?, ?, ?)', [
      id,
      id,
      `${id}@x.test`,
    ]);
    db.run('INSERT INTO user_profiles (user_id) VALUES (?)', [id]);
  }
  db.run(
    "INSERT INTO households (id, name, currency, country) VALUES (?, 'Home', 'GBP', 'GB')",
    [H]
  );
  db.run(
    "INSERT INTO household_members (id, household_id, user_id, role) VALUES ('m-carer', ?, ?, 'nanny')",
    [H, CARER]
  );
}

let n = 0;
function shift(
  db: Database,
  startsAt: string,
  endsAt: string,
  extra: { status?: string; carer?: string | null } = {}
) {
  const id = `s${++n}`;
  db.run(
    `INSERT INTO shifts (id, household_id, carer_id, starts_at, ends_at, timezone, local_date, ical_uid, status, kind)
     VALUES (?, ?, ?, ?, ?, 'Europe/London', substr(?, 1, 10), ?, ?, 'extra')`,
    [
      id,
      H,
      extra.carer === undefined ? CARER : extra.carer,
      startsAt,
      endsAt,
      startsAt,
      `ical-${id}`,
      extra.status ?? 'confirmed',
    ]
  );
  return id;
}

function entry(
  db: Database,
  inAt: string,
  outAt: string | null,
  extra: { kind?: string; status?: string; household?: string } = {}
) {
  const id = `e${++n}`;
  db.run(
    `INSERT INTO time_entries (id, household_id, carer_id, clock_in_at, clock_out_at, timezone, local_date, carer_display_name, kind, status)
     VALUES (?, ?, ?, ?, ?, 'Europe/London', substr(?, 1, 10), 'Carer', ?, ?)`,
    [
      id,
      extra.household ?? H,
      CARER,
      inAt,
      outAt,
      inAt,
      extra.kind ?? 'worked',
      extra.status ?? 'submitted',
    ]
  );
  return id;
}

let db: Database;
beforeEach(() => {
  db = freshDb();
  seed(db);
});

describe('baseline', () => {
  test('loads all 43 tables (email_log dropped in 0002, legal_acceptances added in 0003)', () => {
    const rows = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'"
      )
      .all();
    expect(rows.length).toBe(43);
  });

  test('NOW default matches toISOString() shape', () => {
    const row = db
      .query<{ created_at: string }, [string]>(
        'SELECT created_at FROM households WHERE id = ?'
      )
      .get(H);
    expect(row?.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  test('drizzle can insert through the schema with app-side uuid defaults', () => {
    const d = drizzle(db, { schema });
    const [row] = d
      .insert(schema.children)
      .values({ household_id: H, name: 'Ada' })
      .returning()
      .all();
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('overlap triggers', () => {
  test('shifts_carer_window_excl rejects overlap, accepts adjacent and cancelled', () => {
    shift(db, '2026-03-02T09:00:00.000Z', '2026-03-02T12:00:00.000Z');
    const err = thrown(() =>
      shift(db, '2026-03-02T11:00:00.000Z', '2026-03-02T13:00:00.000Z')
    );
    expect(mapDbError(err)).toEqual({
      kind: 'overlap',
      constraint: 'shifts_carer_window_excl',
    });
    // half-open: [09,12) and [12,15) touch but do not overlap
    shift(db, '2026-03-02T12:00:00.000Z', '2026-03-02T15:00:00.000Z');
    shift(db, '2026-03-02T10:00:00.000Z', '2026-03-02T11:00:00.000Z', {
      status: 'cancelled',
    });
    shift(db, '2026-03-02T10:00:00.000Z', '2026-03-02T11:00:00.000Z', {
      carer: null,
    });
  });

  test('shifts_carer_window_excl fires on update, and un-cancelling into an overlap is refused', () => {
    shift(db, '2026-03-02T09:00:00.000Z', '2026-03-02T12:00:00.000Z');
    const b = shift(db, '2026-03-02T12:00:00.000Z', '2026-03-02T15:00:00.000Z');
    const c = shift(
      db,
      '2026-03-02T10:00:00.000Z',
      '2026-03-02T11:00:00.000Z',
      { status: 'cancelled' }
    );
    expect(
      mapDbError(
        thrown(() =>
          db.run(
            "UPDATE shifts SET starts_at = '2026-03-02T11:00:00.000Z' WHERE id = ?",
            [b]
          )
        )
      )?.kind
    ).toBe('overlap');
    expect(
      mapDbError(
        thrown(() =>
          db.run("UPDATE shifts SET status = 'confirmed' WHERE id = ?", [c])
        )
      )?.constraint
    ).toBe('shifts_carer_window_excl');
    // updating a row against itself is not an overlap
    db.run(
      "UPDATE shifts SET ends_at = '2026-03-02T16:00:00.000Z' WHERE id = ?",
      [b]
    );
  });

  test('time_entries_no_clock_overlap_per_carer spans households; voided and cancellation pay exempt', () => {
    db.run("INSERT INTO households (id, name) VALUES ('h2', 'Other')");
    entry(db, '2026-03-02T09:00:00.000Z', '2026-03-02T12:00:00.000Z');
    const err = thrown(() =>
      entry(db, '2026-03-02T11:00:00.000Z', '2026-03-02T13:00:00.000Z', {
        household: 'h2',
      })
    );
    expect(mapDbError(err)).toEqual({
      kind: 'overlap',
      constraint: 'time_entries_no_clock_overlap_per_carer',
    });
    entry(db, '2026-03-02T12:00:00.000Z', '2026-03-02T13:00:00.000Z', {
      household: 'h2',
    });
    entry(db, '2026-03-02T10:00:00.000Z', '2026-03-02T11:00:00.000Z', {
      household: 'h2',
      status: 'voided',
    });
    entry(db, '2026-03-02T10:00:00.000Z', '2026-03-02T11:00:00.000Z', {
      household: 'h2',
      kind: 'cancellation_paid',
    });
    // a running entry (no clock-out) is not range-checked
    entry(db, '2026-03-02T10:30:00.000Z', null, { status: 'running' });
  });

  test('time_entries_no_overlap_per_household catches cancellation pay inside one household', () => {
    entry(db, '2026-03-02T09:00:00.000Z', '2026-03-02T12:00:00.000Z');
    const err = thrown(() =>
      entry(db, '2026-03-02T10:00:00.000Z', '2026-03-02T11:00:00.000Z', {
        kind: 'cancellation_paid',
      })
    );
    expect(mapDbError(err)).toEqual({
      kind: 'overlap',
      constraint: 'time_entries_no_overlap_per_household',
    });
    entry(db, '2026-03-02T12:00:00.000Z', '2026-03-02T13:00:00.000Z', {
      kind: 'cancellation_paid',
    });
  });

  test('time entry overlap triggers fire on update (clocking out over another entry)', () => {
    entry(db, '2026-03-02T12:00:00.000Z', '2026-03-02T13:00:00.000Z');
    const running = entry(db, '2026-03-02T09:00:00.000Z', null, {
      status: 'running',
    });
    const err = thrown(() =>
      db.run(
        "UPDATE time_entries SET clock_out_at = '2026-03-02T12:30:00.000Z', status = 'submitted' WHERE id = ?",
        [running]
      )
    );
    expect(mapDbError(err)?.kind).toBe('overlap');
    db.run(
      "UPDATE time_entries SET clock_out_at = '2026-03-02T12:00:00.000Z', status = 'submitted' WHERE id = ?",
      [running]
    );
  });
});

describe('integrity triggers', () => {
  test('deleting the Better Auth user cascades through user_profiles', () => {
    shift(db, '2026-03-02T09:00:00.000Z', '2026-03-02T12:00:00.000Z');
    db.run('DELETE FROM user WHERE id = ?', [CARER]);
    expect(
      db.query('SELECT 1 FROM user_profiles WHERE user_id = ?').get(CARER)
    ).toBeNull();
    expect(
      db.query('SELECT 1 FROM household_members WHERE user_id = ?').get(CARER)
    ).toBeNull();
    // shifts.carer_id is ON DELETE SET NULL — the shift survives, unassigned
    expect(
      db
        .query<{ carer_id: string | null }, []>('SELECT carer_id FROM shifts')
        .get()?.carer_id
    ).toBeNull();
  });

  test('draft households refuse shifts', () => {
    db.run("UPDATE households SET state = 'draft' WHERE id = ?", [H]);
    const err = thrown(() =>
      shift(db, '2026-03-02T09:00:00.000Z', '2026-03-02T12:00:00.000Z')
    );
    expect(mapDbError(err)).toEqual({
      kind: 'check',
      constraint: 'refuse_draft_shifts',
    });
  });

  test('household_member_id is stamped from the carer membership', () => {
    const id = entry(
      db,
      '2026-03-02T09:00:00.000Z',
      '2026-03-02T12:00:00.000Z'
    );
    const row = db
      .query<{ household_member_id: string }, [string]>(
        'SELECT household_member_id FROM time_entries WHERE id = ?'
      )
      .get(id);
    expect(row?.household_member_id).toBe('m-carer');
  });

  test('updated_at is stamped on update', () => {
    db.run(
      "UPDATE households SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
      [H]
    );
    db.run("UPDATE households SET name = 'Renamed' WHERE id = ?", [H]);
    const row = db
      .query<{ updated_at: string }, [string]>(
        'SELECT updated_at FROM households WHERE id = ?'
      )
      .get(H);
    expect((row?.updated_at ?? '') > '2020').toBe(true);
  });

  test('a timesheet read receipt does not bump updated_at; a real change does', () => {
    db.run(
      "INSERT INTO timesheets (id, household_id, carer_id, week_start, carer_display_name) VALUES ('t1', ?, ?, '2026-03-02', 'Carer')",
      [H, CARER]
    );
    // an explicit updated_at is honoured (the trigger's WHEN guard)
    db.run(
      "UPDATE timesheets SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = 't1'"
    );
    const updatedAt = () =>
      db
        .query<{ updated_at: string }, []>(
          "SELECT updated_at FROM timesheets WHERE id = 't1'"
        )
        .get()?.updated_at;
    db.run(
      "UPDATE timesheets SET parent_viewed_at = '2026-03-03T00:00:00.000Z' WHERE id = 't1'"
    );
    expect(updatedAt()).toBe('2000-01-01T00:00:00.000Z');
    db.run("UPDATE timesheets SET total_minutes = 60 WHERE id = 't1'");
    expect(updatedAt()).not.toBe('2000-01-01T00:00:00.000Z');
  });

  test('an approved, paid timesheet cannot be reopened', () => {
    db.run(
      `INSERT INTO timesheets (id, household_id, carer_id, week_start, carer_display_name, status, gross_minor, currency, earnings, earnings_computed_at)
       VALUES ('t1', ?, ?, '2026-03-02', 'Carer', 'approved', 1000, 'GBP', '{}', '2026-03-09T00:00:00.000Z')`,
      [H, CARER]
    );
    db.run(
      "INSERT INTO payments (id, timesheet_id, household_id, carer_id, amount_minor, currency, paid_at) VALUES ('p1', 't1', ?, ?, 1000, 'GBP', '2026-03-09')",
      [H, CARER]
    );
    expect(
      String(
        thrown(() =>
          db.run("UPDATE timesheets SET status = 'open' WHERE id = 't1'")
        )
      )
    ).toContain('TIMESHEET_HAS_PAYMENTS');
  });

  test('a child commitment must carry its child household', () => {
    db.run("INSERT INTO households (id, name) VALUES ('h2', 'Other')");
    db.run(
      "INSERT INTO children (id, household_id, name) VALUES ('c1', ?, 'Ada')",
      [H]
    );
    const insert = (hh: string) =>
      db.run(
        "INSERT INTO child_commitments (id, child_id, household_id, rrule, start_time, end_time) VALUES (?, 'c1', ?, 'FREQ=WEEKLY', '09:00', '12:00')",
        [crypto.randomUUID(), hh]
      );
    expect(mapDbError(thrown(() => insert('h2')))?.constraint).toBe(
      'child_commitments_household_matches_child'
    );
    insert(H);
  });
});

describe('mapDbError over real SQLite errors', () => {
  test('plain-column unique maps back to the declared index name', () => {
    const insert = () =>
      db.run(
        "INSERT INTO terms_proposals (household_id, carer_id, proposed_by, direction, terms, carer_display_name, id) VALUES (?, ?, ?, 'parent', '{}', 'Carer', ?)",
        [H, CARER, PARENT, crypto.randomUUID()]
      );
    insert();
    expect(mapDbError(thrown(insert))).toEqual({
      kind: 'unique',
      constraint: 'terms_proposals_open_unique_idx',
    });
  });

  test('expression unique (NULLS NOT DISTINCT window) is reported by index name, null carers collide', () => {
    shift(db, '2026-03-02T09:00:00.000Z', '2026-03-02T12:00:00.000Z', {
      carer: null,
    });
    const err = thrown(() =>
      shift(db, '2026-03-02T09:00:00.000Z', '2026-03-02T12:00:00.000Z', {
        carer: null,
      })
    );
    expect(mapDbError(err)).toEqual({
      kind: 'unique',
      constraint: 'shifts_extra_window_unique',
    });
  });

  test('keyed shift_events unique and composite primary key', () => {
    const ev = () =>
      db.run(
        `INSERT INTO shift_events (id, household_id, local_date, event_type, payload) VALUES (?, ?, '2026-03-02', 'uncovered_care', '{"key":"k1"}')`,
        [crypto.randomUUID(), H]
      );
    ev();
    expect(mapDbError(thrown(ev))).toEqual({
      kind: 'unique',
      constraint: 'shift_events_keyed_unique_idx',
    });

    const claim = () =>
      db.run(
        "INSERT INTO push_reminder_log (user_id, reminder_key) VALUES (?, 'r1')",
        [CARER]
      );
    claim();
    expect(mapDbError(thrown(claim))).toEqual({
      kind: 'unique',
      constraint: 'push_reminder_log_pkey',
    });
  });

  test('foreign key and named check', () => {
    expect(
      mapDbError(
        thrown(() =>
          db.run(
            "INSERT INTO children (id, household_id, name) VALUES ('c9', 'nope', 'X')"
          )
        )
      )
    ).toEqual({
      kind: 'foreign_key',
    });
    expect(
      mapDbError(
        thrown(() =>
          db.run("UPDATE households SET currency = 'gbp' WHERE id = ?", [H])
        )
      )
    ).toEqual({
      kind: 'check',
      constraint: 'households_currency_check',
    });
  });

  test('unwraps a drizzle query error and ignores non-constraint errors', () => {
    const d = drizzle(db, { schema });
    const err = thrown(() =>
      d
        .insert(schema.children)
        .values({ household_id: 'nope', name: 'X' })
        .run()
    );
    expect(mapDbError(err)).toEqual({ kind: 'foreign_key' });
    expect(mapDbError(new Error('boom'))).toBeNull();
    expect(mapDbError(undefined)).toBeNull();
  });
});

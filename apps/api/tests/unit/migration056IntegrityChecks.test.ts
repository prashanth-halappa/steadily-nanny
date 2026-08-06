/**
 * @module tests/unit/migration056IntegrityChecks.test
 * Pattern A — migration contract for `056_integrity_checks.sql`.
 *
 * THE GAP THIS CLOSES. Every guard in this repo prevents a bad write. Nothing
 * detects a wrong number that is ALREADY WRITTEN — a timesheet whose
 * `total_minutes` no longer matches its entries, an approved week whose frozen
 * earnings snapshot went missing, a paid cancellation nobody ever paid. On a
 * payroll app those are silent until a human notices their pay is wrong.
 * `run_integrity_checks()` is the read-only sweep that asks the eight
 * questions, and `integrityCheckJob` turns its answers into error logs and a
 * failed job run.
 *
 * Written BEFORE the migration existed, same discipline as 049/052/053/054.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '056_integrity_checks.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');

/** Executable SQL only — `--` comment lines dropped, whitespace collapsed. */
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/**
 * The eight questions. Each name is also the grouping key
 * `integrityCheckJob` logs under, so renaming one here silently renames an
 * alert.
 */
const CHECK_NAMES = [
  'timesheet_total_mismatch',
  'approved_snapshot_mismatch',
  'pto_net_negative',
  'expense_pending_dup',
  'cancellation_unsettled',
  'entry_overlap',
  'stuck_runner',
  'orphan_week',
] as const;

describe('056 — the function contract', () => {
  it('creates public.run_integrity_checks with no arguments', () => {
    expect(executable).toContain(
      'create or replace function public.run_integrity_checks()'
    );
  });

  it('returns (check_name, entity_id, details) so one job can log every class', () => {
    expect(executable).toContain(
      'returns table (check_name text, entity_id uuid, details jsonb)'
    );
  });

  it('pins search_path', () => {
    expect(executable).toContain('set search_path = public');
  });

  it('is invoker-rights — it needs no privilege the caller lacks', () => {
    // The API calls this with the service-role client, which already bypasses
    // RLS. `security definer` would buy nothing and add an escalation surface
    // (019/024/050 make the same call for the same reason).
    expect(executable).toContain('security invoker');
    expect(executable).not.toContain('security definer');
  });

  it('is service_role only', () => {
    expect(executable).toContain(
      'revoke all on function public.run_integrity_checks() from public'
    );
    expect(executable).toContain(
      'revoke all on function public.run_integrity_checks() from anon'
    );
    expect(executable).toContain(
      'revoke all on function public.run_integrity_checks() from authenticated'
    );
    expect(executable).toContain(
      'grant execute on function public.run_integrity_checks() to service_role'
    );
  });

  it('reads only — an integrity sweep must never repair anything', () => {
    // A sweep that writes is a sweep that can corrupt on a bad predicate, and
    // it destroys the evidence a human needs. Report, never repair.
    for (const forbidden of [
      'insert into',
      'update public.',
      'delete from',
      'truncate',
      'alter table',
      'drop table',
    ]) {
      expect(executable).not.toContain(forbidden);
    }
  });
});

describe('056 — all eight checks are present', () => {
  for (const name of CHECK_NAMES) {
    it(`emits "${name}"`, () => {
      expect(executable).toContain(`'${name}'::text`);
    });
  }
});

describe('056 — the minutes formula is the cross-lane contract', () => {
  // THE POINT OF THIS BLOCK. Check #1 recomputes a week's minutes in SQL and
  // compares it against `timesheets.total_minutes`, which TypeScript wrote
  // via `computeWorkedMinutes`/`sumWorkedMinutes`
  // (apps/api/src/domains/timesheet/utils/workedMinutes.ts). If the two
  // formulas drift, this check reports every timesheet in the database as
  // broken and the alert becomes noise nobody reads — the exact failure mode
  // that makes monitoring worse than none.

  it('mirrors computeWorkedMinutes: rounded span minus break, floored at zero', () => {
    expect(executable).toContain(
      'round(extract(epoch from (te.clock_out_at - te.clock_in_at)) / 60)'
    );
    expect(executable).toContain('- te.break_minutes');
    expect(executable).toContain('greatest(0,');
  });

  it('honours C7: scheduled_minutes is authoritative for cancellation pay', () => {
    // Lane B promotes `scheduled_minutes` to the banked figure for
    // `kind = 'cancellation_paid'` so the round-once residual is conserved.
    // Without the same coalesce here, every residual-bearing fragment reads
    // as a one-minute mismatch.
    expect(executable).toContain("te.kind = 'cancellation_paid'");
    expect(executable).toContain('coalesce(te.scheduled_minutes');
  });

  it('counts only completed entries, like sumWorkedMinutes', () => {
    // A running entry contributes 0 in TS (no clock_out_at), so it must
    // contribute nothing here either.
    expect(executable).toContain('te.clock_in_at is not null');
    expect(executable).toContain('te.clock_out_at is not null');
  });
});

describe('056 — check predicates that pin a specific past defect', () => {
  it('stuck_runner uses a 20-hour horizon, clear of the 16h max session', () => {
    expect(executable).toContain("interval '20 hours'");
    expect(executable).toContain("te.status = 'running'");
  });

  it('cancellation_unsettled waits 2 hours, outside the hourly reconcile window', () => {
    expect(executable).toContain("interval '2 hours'");
    expect(executable).toContain('s.cancellation_paid');
  });

  it('expense_pending_dup reuses 051’s identity columns exactly', () => {
    // A regression canary for the dedupe index. Diverging from 051's column
    // list would make this check disagree with the constraint it is watching.
    for (const column of [
      'e.household_id',
      'e.carer_id',
      'e.local_date',
      'e.kind',
      'e.description',
      'e.currency',
      'coalesce(e.amount_minor, -1)',
      'coalesce(e.miles, -1)',
    ]) {
      expect(executable).toContain(column);
    }
    expect(executable).toContain("e.status = 'pending'");
  });

  it('entry_overlap reproduces 055’s two permission rules', () => {
    // Per-carer (presence) excludes cancellation pay; per-household refuses
    // any two overlapping entries. Half-open ranges, as `spansOverlap` is.
    expect(executable).toContain("<> 'cancellation_paid'");
    expect(executable).toContain('tstzrange(');
    expect(executable).toContain('&&');
  });

  it('pto_net_negative reads the ledger’s sign convention the right way round', () => {
    // `minutes` is signed and "paying MORE is more negative"
    // (ptoCommandService.ts), so net PAID minutes is -sum(minutes). A
    // positive sum means more was reversed than was ever taken.
    expect(executable).toContain('sum(pl.minutes) > 0');
    expect(executable).toContain('pl.time_off_id is not null');
  });

  it('approved_snapshot_mismatch catches both halves of a torn snapshot', () => {
    expect(executable).toContain("ts.status = 'approved'");
    expect(executable).toContain('ts.gross_minor is null');
    expect(executable).toContain('ts.earnings is null');
  });
});

describe('056 — documentation contract', () => {
  for (const phrase of [
    // Why detection, not just prevention.
    'already',
    // The formula twin that must move together.
    'workedminutes',
    // The read-only promise.
    'never repair',
    // What consumes the rows.
    'integritycheckjob',
  ]) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});

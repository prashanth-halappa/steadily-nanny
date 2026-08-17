/**
 * @module tests/unit/migration102PaidWeekGuards.test
 * Pattern A — migration contract for `102_paid_week_guards.sql`, written
 * BEFORE the migration existed (045/079/092/100 discipline).
 *
 * WHAT THIS MIGRATION CLOSES. `docs/AS-BUILT-PAYMENT.md` §7 P1/P2/P8:
 *
 * - **P1 — nothing consults `payments` before a week's gross is cleared.**
 *   `record_timesheet_payment` takes a `FOR UPDATE` on the week and bounds
 *   the payment by the frozen `gross_minor`; both ways OUT of `approved` —
 *   the parent's manual reopen and the nanny's clock-out roll-up — were plain
 *   PostgREST updates that nulled that gross without ever asking whether
 *   money had moved against it. The manual reopen is now REFUSED by a trigger
 *   when payment rows exist; the roll-up moves into
 *   `roll_up_timesheet_hours`, which keeps the approved status and the whole
 *   snapshot on a PAID week and flags it instead.
 * - **P2 — `approved ⇒ frozen snapshot` was a service-layer invariant only.**
 *   042:87 says so in as many words. It is now a CHECK.
 * - **P8 — append-only in name.** `payments` grows a partial unique index on
 *   `idempotency_key`, which is what makes a retried POST return the row the
 *   first attempt wrote instead of filing a second real one.
 *
 * ASSERTION SHAPE. Comment-stripped, whitespace-collapsed, lowercased
 * executable SQL, exactly like `migration100TimesheetParentViewed.test.ts` —
 * the prose in this migration's header names every hazard it guards, so a
 * naive `toContain` over the raw file would pass on the WARNING rather than
 * on the statement.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractFunctionBody,
  extractFunctionGrantBlock,
  statementPrecedes,
} from '../helpers/sqlMigrationHelpers';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '102_paid_week_guards.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');

/**
 * Executable SQL only — `--` comment lines dropped, whitespace collapsed, and
 * the space either side of a bracket normalised away so a statement wrapped
 * for readability still matches the assertion that names it.
 *
 * The stripping is load-bearing here, not tidiness: this migration's header
 * names every hazard it guards ("do not narrow this sum", "never edit the
 * shared trigger"), so a `toContain` over the raw file would pass on the
 * WARNING rather than on the statement.
 */
function execSql(sql: string): string {
  return sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .toLowerCase();
}

const executable = execSql(migrationSql);

/** One function's body, comment-stripped and normalised the same way. */
function bodyExec(fnName: string): string {
  return execSql(extractFunctionBody(migrationSql, fnName));
}

describe('102 — idempotency key on payments', () => {
  it('adds a nullable idempotency_key text column', () => {
    expect(executable).toContain(
      'alter table public.payments add column if not exists idempotency_key text'
    );
    expect(executable).not.toContain('idempotency_key text not null');
  });

  it('makes it unique only where it is set — a PARTIAL index', () => {
    expect(executable).toContain(
      'create unique index if not exists payments_idempotency_key_uidx on public.payments (idempotency_key) where idempotency_key is not null'
    );
  });
});

describe('102 — record_timesheet_payment re-issued with the key', () => {
  it('DROPS 077/085s five-arg signature before re-issuing (D46)', () => {
    // `create or replace` with a DIFFERENT argument list creates a second
    // OVERLOAD: the old five-arg function stays live and callable, the new
    // one inherits no grants, and an unqualified `comment on function` fails
    // with 42725. The drop must come FIRST in the file, not merely exist.
    const dropIdx = executable.indexOf(
      'drop function if exists public.record_timesheet_payment(uuid, integer, date, text, uuid)'
    );
    const createIdx = executable.indexOf(
      'create or replace function public.record_timesheet_payment('
    );
    expect(dropIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(dropIdx);
  });

  it('declares the sixth parameter defaulted, so older callers still bind', () => {
    expect(executable).toContain('p_idempotency_key text default null');
  });

  it('checks the key only AFTER the row lock — the whole point of the lock', () => {
    // A key check that read the statement snapshot would miss a payment that
    // committed while this call was queued on the lock, and file the second
    // row anyway (077's rule).
    const body = bodyExec('record_timesheet_payment');
    statementPrecedes(body, 'for update', 'p_idempotency_key is not null');
    expect(body).toContain("'outcome', 'recorded'");
  });

  it('stamps the key onto the inserted row', () => {
    const body = bodyExec('record_timesheet_payment');
    // Named in the insert's column list, not only in the declare block.
    const insertIdx = body.indexOf('insert into public.payments');
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(body.slice(insertIdx)).toContain('idempotency_key');
  });

  it('keeps the un-narrowed signed sum, and the comment that keeps it that way', () => {
    const body = bodyExec('record_timesheet_payment');
    expect(body).toContain(
      'from public.payments where timesheet_id = p_timesheet_id'
    );
    // The trap 085's header spells out: `where kind = 'payment'` would make
    // the gate refuse a legitimate payment after a downward correction.
    expect(body).not.toContain("kind = 'payment'");
    // And the warning itself stays in the body a future reader is editing,
    // not only in a migration header nobody opens (085's own argument).
    expect(
      extractFunctionBody(migrationSql, 'record_timesheet_payment')
    ).toContain('DO NOT ADD A KIND FILTER TO THIS SUM');
  });

  it('re-issues the revoke/grant block against the NEW six-arg signature', () => {
    const grants = extractFunctionGrantBlock(
      migrationSql,
      'record_timesheet_payment'
    ).toLowerCase();
    expect(grants).toContain('uuid, integer, date, text, uuid, text');
    expect(grants).toContain('from public');
    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
  });
});

describe('102 — hours_changed_after_payment_at', () => {
  it('adds a nullable timestamptz with no default', () => {
    expect(executable).toContain(
      'alter table public.timesheets add column if not exists hours_changed_after_payment_at timestamptz'
    );
    expect(executable).not.toContain(
      'hours_changed_after_payment_at timestamptz not null'
    );
    expect(executable).not.toContain(
      'hours_changed_after_payment_at timestamptz default'
    );
  });

  it('documents the column', () => {
    expect(executable).toContain(
      'comment on column public.timesheets.hours_changed_after_payment_at is'
    );
  });
});

describe('102 — roll_up_timesheet_hours', () => {
  it('locks the week BEFORE asking whether it has been paid', () => {
    // The reason this is an RPC at all. A plain UPDATE's `exists` subquery
    // reads the STATEMENT snapshot, so a payment that committed while this
    // call waited on the lock would be invisible and the week would be
    // demoted out from under it. plpgsql after the row lock sees it.
    const body = bodyExec('roll_up_timesheet_hours');
    statementPrecedes(body, 'for update', 'select exists');
    expect(body).toContain(
      'select exists(select 1 from public.payments where timesheet_id = p_timesheet_id)'
    );
  });

  it('writes the whole decision in ONE update statement', () => {
    const body = bodyExec('roll_up_timesheet_hours');
    expect(body.match(/update public\.timesheets/g)?.length).toBe(1);
    expect(body).toContain('return query update public.timesheets');
    expect(body).toContain('returning *');
  });

  it('keeps status, approver and ALL FOUR snapshot columns when the week is paid', () => {
    const body = bodyExec('roll_up_timesheet_hours');
    for (const column of [
      'status',
      'approved_by',
      'approved_at',
      'gross_minor',
      'currency',
      'earnings',
      'earnings_computed_at',
    ]) {
      expect(body).toContain(`${column} = case when v_paid then`);
    }
    // The unpaid arm is still D1's unconditional clear: demote and null out.
    expect(body).toContain("else 'submitted'");
  });

  it('sets the flag on a paid roll-up and clears it on an unpaid one', () => {
    const body = bodyExec('roll_up_timesheet_hours');
    expect(body).toContain(
      'hours_changed_after_payment_at = case when v_paid then now() else null end'
    );
  });

  it('is security invoker with a pinned search_path, service_role only', () => {
    expect(executable).toContain(
      'create or replace function public.roll_up_timesheet_hours(p_timesheet_id uuid, p_total_minutes integer) returns setof public.timesheets language plpgsql security invoker set search_path = public'
    );
    const grants = extractFunctionGrantBlock(
      migrationSql,
      'roll_up_timesheet_hours'
    ).toLowerCase();
    expect(grants).toContain('from public');
    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
  });
});

describe('102 — the reopen-when-paid trigger', () => {
  it('raises TIMESHEET_HAS_PAYMENTS on any approved -> not-approved move with payments', () => {
    expect(executable).toContain(
      'create trigger timesheets_refuse_reopen_when_paid before update on public.timesheets'
    );
    const body = bodyExec('timesheets_refuse_reopen_when_paid');
    expect(body).toContain("old.status = 'approved'");
    expect(body).toContain("new.status <> 'approved'");
    expect(body).toContain(
      'exists (select 1 from public.payments where timesheet_id = old.id)'
    );
    expect(body).toContain("raise exception 'timesheet_has_payments'");
    expect(body).toContain("errcode = 'p0001'");
  });

  it('leaves migration 100s updated_at trigger alone', () => {
    // 100's `set_timesheets_updated_at` preserves OLD.updated_at for a
    // `parent_viewed_at`-only write, and approve compare-and-swaps on that
    // column. Redefining it here would break the parent's approve tap.
    expect(executable).not.toContain(
      'function public.set_timesheets_updated_at'
    );
    expect(executable).not.toContain('function public.set_updated_at');
  });
});

describe('102 — P2: an approved week must carry its frozen snapshot', () => {
  it('adds the CHECK naming all four snapshot columns', () => {
    expect(executable).toContain(
      "alter table public.timesheets add constraint timesheets_approved_has_snapshot check (status <> 'approved' or (gross_minor is not null and currency is not null and earnings is not null and earnings_computed_at is not null))"
    );
  });

  it('drops the constraint by name first, so the migration is re-runnable', () => {
    const dropIdx = executable.indexOf(
      'drop constraint if exists timesheets_approved_has_snapshot'
    );
    const addIdx = executable.indexOf(
      'add constraint timesheets_approved_has_snapshot'
    );
    expect(dropIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(dropIdx);
  });
});

describe('102 — money discipline', () => {
  it('never clamps a figure', () => {
    // `docs/11-MONEY.md` §1: refused, never trimmed to fit. A `least(`/
    // `greatest(` anywhere in a money path is a clamp wearing a function name.
    expect(executable).not.toContain('least(');
    expect(executable).not.toContain('greatest(');
  });

  it('carries the pre-flight SELECTs the constraint and the index assume', () => {
    // Prod is at 0 payments / 0 timesheets today, which is why neither the
    // CHECK nor the unique index needs `not valid` + a backfill. That is a
    // fact about a moment, so the queries that re-establish it are in the
    // header rather than in someone's memory.
    expect(migrationSql).toContain(
      "select count(*) from public.timesheets where status = 'approved'"
    );
    expect(migrationSql).toContain('select count(*) from public.payments');
  });
});

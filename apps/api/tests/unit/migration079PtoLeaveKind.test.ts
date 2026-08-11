/**
 * @module tests/unit/migration079PtoLeaveKind.test
 * Pattern A — migration contract for `079_pto_ledger_leave_kind.sql`, written
 * BEFORE the migration existed (045/050/068 discipline).
 *
 * WHY THIS MIGRATION EXISTS (§5 D-11, gap T5). 068 gave `carer_time_off` a
 * `kind` discriminator so a same-day absence renders as sickness rather than
 * a holiday request. What it did NOT label is the PTO *draw*: the ledger row
 * that records this household paying for that day. D-11 keeps ONE pool — no
 * split balances, no per-hour accrual, no configurable leave year — but the
 * ledger still has to record what a paid day WAS, so 3-T3's D-23 interplay
 * (sick time-off auto-opens cancel change-requests; sick-labelled PTO drawn)
 * has a label to draw against.
 *
 * WHY A SNAPSHOT COLUMN AND NOT A JOIN. `time_off_id` already points at the
 * time-off row, so the label looks derivable. It is not, for three reasons,
 * each of which alone settles it:
 *   1. `time_off_id` is `on delete set null` (043) — the join evaporates.
 *   2. `carer_time_off.kind` is PATCHable (`UpdateCarerTimeOffSchema` can
 *      promote a requested personal row to sick), and the ledger is
 *      append-only history: it must record what the day WAS when it was
 *      drawn, not what the time off later became.
 *   3. `carer_time_off` carries no household reference (011) — resolving the
 *      label on every household's ledger read means reaching outside that
 *      household's scope on a pure read path.
 * That is exactly `carer_display_name`'s snapshot argument from 043, applied
 * to the second field the ledger cannot afford to lose.
 *
 * WHY THE FUNCTION STAMPS IT, NOT THE CALLER. Every usage and adjustment row
 * is written by `apply_pto_correction` (050: "EVERY marking goes through
 * here, including the FIRST one"), which already holds the `carer_time_off`
 * row it locked FOR UPDATE. Taking the label from that locked row rather
 * than from caller-supplied `p_rows` is 050's own security stance —
 * `household_id` and `time_off_id` are not read from the payload either —
 * and it means no service code has to remember to send it.
 *
 * NO BACKFILL, deliberately (D-9: pre-launch wipe — all grandfathering work
 * cut). The column is nullable with no default: null means "not recorded",
 * which is the honest reading of an accrual row (it draws no leave) and of
 * any pre-079 row. A default would assert `personal` about days nobody
 * labelled.
 *
 * WHAT MUST NOT MOVE. The balance is still `sum(minutes)` over one pool; the
 * table is still append-only; 045's per-day partial unique index and 050's
 * compare-and-set are untouched; `apply_pto_correction` keeps its five-arg
 * signature, so D46's drop-before-replace trap is not armed.
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
const MIGRATION = '079_pto_ledger_leave_kind.sql';
const FN = 'apply_pto_correction';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');

/** Executable SQL only — `--` comment lines dropped, whitespace collapsed. */
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** Only the `--` comment lines — the documentation contract. */
const comments = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const body = extractFunctionBody(migrationSql, FN).toLowerCase();

describe('079 — adds pto_ledger.leave_kind', () => {
  it('adds the column idempotently', () => {
    expect(executable).toContain(
      'alter table public.pto_ledger add column if not exists leave_kind text'
    );
  });

  it('leaves the column nullable with no default — null means "not recorded"', () => {
    // An accrual row draws no leave, and D-9 wiped everything pre-launch, so
    // there is nothing to backfill and nothing to assert about unlabelled days.
    expect(executable).not.toContain('leave_kind text not null');
    expect(executable).not.toContain("leave_kind text default 'personal'");
    expect(executable).not.toContain('update public.pto_ledger');
  });

  it('bounds the label to 068’s kinds, allowing null', () => {
    expect(executable).toContain(
      "check ( leave_kind is null or leave_kind in ('personal', 'sick') )"
    );
  });

  it('drops the constraint before adding it — re-runnable house pattern (053/055/063/068)', () => {
    expect(executable).toContain(
      'drop constraint if exists pto_ledger_leave_kind_check'
    );
    expect(
      statementPrecedes(
        executable,
        'drop constraint if exists pto_ledger_leave_kind_check',
        'add constraint pto_ledger_leave_kind_check'
      )
    ).toBe(true);
  });

  it('documents the column', () => {
    expect(executable).toContain(
      'comment on column public.pto_ledger.leave_kind'
    );
  });
});

describe('079 — apply_pto_correction stamps the label from the LOCKED row', () => {
  it('still locks the carer_time_off row FOR UPDATE before anything else', () => {
    expect(body).toContain('from public.carer_time_off');
    expect(body).toContain('for update');
    expect(
      statementPrecedes(body, 'for update', 'insert into public.pto_ledger')
    ).toBe(true);
  });

  it('names leave_kind in the insert’s column list', () => {
    const insert = body.slice(body.indexOf('insert into public.pto_ledger'));
    expect(insert.slice(0, insert.indexOf(') select'))).toContain('leave_kind');
  });

  it('takes the label from the locked time-off row, never from p_rows', () => {
    // 050's security stance: household_id and time_off_id are not read from
    // the caller's payload either. A caller cannot label its own draw.
    expect(body).toContain('v_leave_kind');
    expect(body).toContain('v_time_off.kind');
    expect(body).not.toContain('r.leave_kind');
    // `leave_kind` must not appear in the jsonb_to_recordset column list.
    const recordset = body.slice(body.indexOf('jsonb_to_recordset'));
    expect(recordset.slice(0, recordset.indexOf('returning'))).not.toContain(
      'leave_kind'
    );
  });

  it('reads the label BEFORE it writes with it', () => {
    expect(statementPrecedes(body, 'v_leave_kind', 'insert into')).toBe(true);
  });
});

describe('079 — it weakens nothing', () => {
  it('keeps apply_pto_correction’s five-arg signature (D46 stays disarmed)', () => {
    // A changed arg list would need a drop-before-replace; the same list means
    // `create or replace` is enough and no grant is silently dropped.
    expect(executable).toContain(
      'create or replace function public.apply_pto_correction( p_household_id uuid, p_time_off_id uuid, p_expected jsonb, p_rows jsonb, p_require_confirmed boolean )'
    );
    expect(executable).not.toContain('drop function');
  });

  it('re-grants execute to service_role only', () => {
    const grants = extractFunctionGrantBlock(migrationSql, FN).toLowerCase();
    expect(grants).toContain(
      'revoke all on function public.apply_pto_correction'
    );
    expect(grants).toContain('from public');
    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
  });

  it('keeps the compare-and-set and the outcome envelope', () => {
    expect(body).toContain("return jsonb_build_object('outcome', 'stale'");
    expect(body).toContain("'outcome', 'applied'");
    expect(body).toContain("'outcome', 'not_confirmed'");
    expect(body).toContain("'outcome', 'time_off_not_found'");
  });

  it('touches no index, no policy, and no other table', () => {
    expect(executable).not.toContain('drop index');
    expect(executable).not.toContain('create index');
    expect(executable).not.toContain('create unique index');
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain('drop policy');
    expect(executable).not.toContain('alter table public.carer_time_off');
    expect(executable).not.toContain('alter table public.pay_arrangements');
    expect(executable).not.toContain(
      'pto_ledger_one_usage_per_time_off_day_idx'
    );
    expect(executable).not.toContain('pto_ledger_one_accrual_per_year_idx');
  });

  it('adds no update or delete path to an append-only table', () => {
    expect(executable).not.toContain('update public.pto_ledger');
    expect(executable).not.toContain('delete from public.pto_ledger');
    expect(executable).not.toContain('updated_at');
  });

  it('does not touch the busy-block view — sickness must not leak cross-household', () => {
    // 068's privacy line: v_busy_blocks exposes the anonymised BLOCK kind.
    // Labelling a household’s own ledger row must not move it.
    expect(executable).not.toContain('v_busy_blocks');
    expect(executable).not.toContain('create or replace view');
  });
});

describe('079 — documentation contract', () => {
  for (const phrase of [
    // The decision this implements and the slice that consumes it.
    'd-11',
    'd-23',
    // The one-pool invariant D-11 pins.
    'pool',
    // Why a snapshot beats a join.
    'append-only',
    'on delete set null',
    // Where the label comes from.
    'locked',
    // Why there is no backfill.
    'null',
  ]) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(comments).toContain(phrase);
    });
  }
});

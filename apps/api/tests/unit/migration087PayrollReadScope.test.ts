/**
 * @module tests/unit/migration087PayrollReadScope.test
 * Pattern A — migration contract for `087_payroll_read_scope.sql`
 * (D-21, gaps P4/P8; plus P9's drop-or-document call).
 *
 * 018 (repointed by 040) gave `timesheets` and `time_entries` the WIDE read
 * predicate `can_read_household`, which is `is_household_member` — any active
 * member, any role. `timesheets` carries `gross_minor` and the frozen
 * `earnings` snapshot, so that policy hands a HELPER and a SECOND NANNY
 * another carer's pay, and `time_entries` hands them her exact clock times,
 * breaks and notes. Every other money table in this schema (041, 043, 044,
 * 067) uses `can_write_household` plus a carer self-arm, and 041's header
 * already argues why: "a policy looser than the service is not belt and
 * braces, it is the hole the service was written to close."
 *
 * 087 makes the two hours tables match the four money tables. The service
 * gate moves in the same commit (`assertPayrollReader`) — this file pins the
 * database half.
 *
 * It also carries P9: the dead enum values get a `comment on column` rather
 * than a drop. That choice is asserted here so it is a recorded decision and
 * not an omission.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '087_payroll_read_scope.sql';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

const migrationSql = readMigration(MIGRATION);
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** The one predicate every money table in this schema already uses. */
const MONEY_READ_CIRCLE =
  'private.can_write_household(household_id) or carer_id = (select auth.uid())';

describe('087 — timesheets and time_entries join the money read circle', () => {
  for (const table of ['timesheets', 'time_entries'] as const) {
    it(`replaces ${table}'s wide select policy by dropping it first`, () => {
      expect(executable).toContain(
        `drop policy if exists "members can view ${table.replace('_', ' ')}" on public.${table}`
      );
    });

    it(`recreates ${table}'s select policy with the 067/044 predicate`, () => {
      const policy = new RegExp(
        `create policy "[^"]+" on public\\.${table} for select using \\(([^;]*?)\\)\\s*;`
      ).exec(`${executable};`);
      expect(policy?.[1]?.replace(/\s+/g, ' ').trim()).toBe(MONEY_READ_CIRCLE);
    });
  }

  it('drops can_read_household from both — a helper never sees pay again', () => {
    expect(executable).not.toContain('can_read_household');
  });

  it('keeps the helper call BARE (040 trap 2 — no (select …) wrapper)', () => {
    expect(executable).not.toContain('(select private.can_write_household');
  });

  it('keeps 018’s initplan form on the carer self-arm', () => {
    expect(executable).toContain('(select auth.uid())');
  });

  it('adds no insert/update/delete policy — 049/052 lockdown stands', () => {
    expect(executable).not.toContain('for insert');
    expect(executable).not.toContain('for update');
    expect(executable).not.toContain('for delete');
  });
});

describe('087 — P9: the dead enum values are DOCUMENTED, not dropped', () => {
  it('leaves both CHECK constraints alone', () => {
    expect(executable).not.toContain('drop constraint');
    expect(executable).not.toContain('add constraint');
  });

  it("comments timesheets.status, naming 'open' as dead", () => {
    expect(executable).toContain('comment on column public.timesheets.status');
    expect(executable).toContain("''open'' is dead");
  });

  it("comments time_entries.status, naming 'approved'/'queried' as dead", () => {
    expect(executable).toContain(
      'comment on column public.time_entries.status'
    );
    expect(executable).toContain("''approved'' and ''queried'' are dead");
  });

  it('records WHY documenting beat dropping, so nobody re-opens it', () => {
    expect(commentText).toContain('shipped clients');
  });
});

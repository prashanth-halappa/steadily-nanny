/**
 * @module tests/unit/migration058HouseholdMemberIdentity.test
 * Pattern A — migration contract for `058_household_member_identity.sql`.
 *
 * Written BEFORE the migration existed, same discipline as 049/052/053/054.
 *
 * THE DEFECT THIS PINS
 * `033_preserve_payroll_on_carer_deletion.sql` keeps a departed carer's
 * payroll rows by NULLing `carer_id` and leaning on the `carer_display_name`
 * snapshot. Two carers who both left and happened to share a display name
 * therefore collapse into ONE bucket on every parent surface that groups by
 * `carer_id ?? carer_display_name` — one set of tabs, one summed total, one
 * approve button pointed at whichever row sorted first.
 *
 * The fix is a per-MEMBERSHIP identity stamped at insert time, so it is
 * already on the row long before the account is deleted. `household_members`
 * has a surrogate `id` (009_households.sql:70) that is unique per
 * (household, user) and is exactly that identity.
 *
 * WHY THE TEXT ASSERTIONS BELOW ARE THE CONTRACT, not incidental style:
 *  - NO foreign key. The whole point is to outlive the membership row, which
 *    `033`'s cascade deletes. An FK would take the value with it.
 *  - BEFORE INSERT only. Account deletion fires the FK's `on delete set
 *    null`, which is an UPDATE; a trigger that also ran `or update` would
 *    re-resolve the (now unresolvable) membership and blank the stamp at the
 *    exact moment it starts to matter.
 *  - The backfill's join shape, so pre-058 rows whose carer is still around
 *    get their identity too.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '058_household_member_identity.sql';

/** The five payroll tables that carry `(household_id, carer_id)`. */
const TABLES = [
  'time_entries',
  'timesheets',
  'pay_arrangements',
  'pto_ledger',
  'expenses',
] as const;

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

const migrationSql = readMigration(MIGRATION);

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

describe('058 — the column lands on all five payroll tables', () => {
  for (const table of TABLES) {
    it(`adds household_member_id to ${table}`, () => {
      expect(executable).toContain(
        `alter table public.${table} add column if not exists household_member_id uuid`
      );
    });
  }
});

describe('058 — no foreign key, or the identity dies with the membership', () => {
  // `household_members.user_id` keeps `on delete cascade` (033's header says
  // so deliberately): deleting the account deletes the membership row. A FK
  // from a payroll table to it would either block that delete or null the
  // stamp — both destroy the thing this migration exists to preserve.
  it('declares no references clause on the new column', () => {
    expect(executable).not.toContain('household_member_id uuid references');
    expect(executable).not.toContain('foreign key (household_member_id)');
    expect(executable).not.toContain('references public.household_members');
  });

  // Never filtered server-side — the column is read only as a client-side
  // grouping key. An index would be pure write cost on five hot tables.
  it('creates no index on the new column', () => {
    expect(executable).not.toContain('index');
  });
});

describe('058 — the stamping function resolves membership from (household, carer)', () => {
  it('creates one shared function in the private schema', () => {
    expect(executable).toContain(
      'create or replace function private.stamp_household_member_id()'
    );
  });

  it('coalesces so an explicitly supplied value is never overwritten', () => {
    expect(executable).toMatch(
      /new\.household_member_id := coalesce\( ?new\.household_member_id,/
    );
  });

  it('looks the membership up by household AND user, the unique pair', () => {
    expect(executable).toContain(
      'select id from public.household_members hm where hm.household_id = new.household_id and hm.user_id = new.carer_id'
    );
  });

  // `carer_id` is nullable on all five tables. `hm.user_id = null` is NULL,
  // never true, so the subselect yields no row and the stamp stays NULL —
  // no exception, no bogus match. Pinned because a future rewrite into an
  // `into ... strict` form would start raising on exactly this path.
  it('documents the null-carer_id case as a no-match, not an error', () => {
    expect(commentText).toContain('null');
    expect(commentText).toContain('carer_id');
  });
});

describe('058 — triggers fire on INSERT and nothing else', () => {
  for (const table of TABLES) {
    it(`stamps ${table} before insert`, () => {
      expect(executable).toContain(`before insert on public.${table}`);
    });

    it(`drops any prior trigger on ${table} so re-running is safe`, () => {
      expect(executable).toContain(
        `drop trigger if exists ${table}_stamp_household_member_id on public.${table}`
      );
    });
  }

  // THE LOAD-BEARING ASSERTION. A carer deleting her account fires
  // `on delete set null` on `carer_id` — an UPDATE. If the trigger also ran
  // on update it would re-resolve the membership (now cascade-deleted),
  // coalesce against a NULL subselect... and, worse, any future update
  // touching a row would keep the stamp only by luck of the coalesce. The
  // stamp is written once, at birth, and never revisited.
  it('never fires on update — that is when the carer_id goes NULL', () => {
    expect(executable).not.toContain('or update');
    expect(executable).not.toContain('before insert or update');
    expect(executable).not.toContain('after update');
  });

  it('binds every trigger to the one shared function', () => {
    const executions = executable.match(
      /execute function private\.stamp_household_member_id\(\)/g
    );
    expect(executions).toHaveLength(TABLES.length);
  });
});

describe('058 — backfills existing rows whose carer is still a member', () => {
  for (const table of TABLES) {
    it(`backfills ${table} by joining household_members on both columns`, () => {
      expect(executable).toContain(
        `update public.${table} t set household_member_id = hm.id from public.household_members hm where t.carer_id = hm.user_id and t.household_id = hm.household_id and t.household_member_id is null`
      );
    });
  }
});

describe('058 — changes nothing else', () => {
  it('creates no table and drops no column', () => {
    expect(executable).not.toContain('create table');
    expect(executable).not.toContain('drop column');
  });

  it('touches no policy — the column is additive and not a permission input', () => {
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain('drop policy');
  });

  it('deletes no data', () => {
    expect(executable).not.toContain('delete from');
    expect(executable).not.toContain('truncate');
  });
});

describe('058 — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // Why it exists at all.
    'display name',
    '033',
    // The two accepted limits a reader must not have to rediscover.
    'forward-only',
    'per engagement',
    // The insert-only reasoning.
    'set null',
    'update',
    // The no-FK reasoning.
    'no foreign key',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});

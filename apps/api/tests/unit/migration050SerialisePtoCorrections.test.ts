/**
 * @module tests/unit/migration050SerialisePtoCorrections.test
 * Pattern A — migration contract for `050_serialise_pto_corrections.sql`.
 *
 * Written BEFORE the migration exists (TDD red-first), like 045's.
 *
 * WHY THIS MIGRATION EXISTS (F-B4-2). `ptoCommandService.writeCorrection` and
 * `reverseNettedUsage` both READ the household's netted per-day total for one
 * time off and THEN insert `adjustment` rows for the difference. Nothing
 * holds a lock in between: two parents correcting 8h → 6h at the same instant
 * both read 8h, both write −(−2h), and the ledger lands at 4h. That is real
 * money owed, silently wrong, in an append-only table nobody can edit back.
 *
 * WHAT IS *NOT* BROKEN, AND MUST NOT BE "FIXED". The FIRST marking is already
 * serialised by 045's `pto_ledger_one_usage_per_time_off_day_idx` — two
 * concurrent first marks yield one winner and one typed 409. `adjustment`
 * rows deliberately carry no unique index, because unlimited corrections per
 * `(household, time_off)` is the whole point of the delta rule
 * (docs/11-MONEY.md §5). So the answer is serialisation, not a constraint,
 * and this migration must leave both existing indexes completely alone.
 *
 * THE SHAPE is 024's and 027's: lock an anchor row FOR UPDATE first, do the
 * read-compute-write under that lock, and return an outcome jsonb rather than
 * raising so the TS layer maps it to a typed error. The anchor is the
 * `carer_time_off` row every correction and reversal for one time off shares
 * — and which a cancel also locks when it flips the status, so a cancel
 * racing a correction serialises for free.
 *
 * COMPARE-AND-SET, not compute-in-SQL: the caller sends the per-day state it
 * computed its deltas from and the rows it wants written, and the function
 * refuses with `stale` if that state moved under the lock. The money
 * arithmetic (`allocateMinutes`, the household timezone's covered days, the
 * note keys) therefore stays in one tested place in TypeScript instead of
 * being re-implemented in plpgsql where no unit test can reach it.
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
const MIGRATION = '050_serialise_pto_corrections.sql';
const FN = 'apply_pto_correction';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

/** Executable SQL: `--` comment lines stripped, whitespace flattened. */
function executableSql(sql: string): string {
  return sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Only the `--` comment lines — the documentation contract. */
function commentText(sql: string): string {
  return sql
    .split('\n')
    .filter(line => line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const migrationSql = readMigration(MIGRATION);
const executable = executableSql(migrationSql);
const comments = commentText(migrationSql);
const body = extractFunctionBody(migrationSql, FN).toLowerCase();

describe('050_serialise_pto_corrections.sql — the lock', () => {
  it('locks the carer_time_off row FOR UPDATE', () => {
    expect(body).toContain('from public.carer_time_off');
    expect(body).toContain('for update');
  });

  it('takes the lock BEFORE reading the ledger it computes from', () => {
    expect(
      statementPrecedes(body, 'for update', 'from public.pto_ledger')
    ).toBe(true);
  });

  it('takes the lock BEFORE the mutating insert', () => {
    expect(
      statementPrecedes(body, 'for update', 'insert into public.pto_ledger')
    ).toBe(true);
  });

  it('re-derives the per-day netted total under the lock, rather than trusting the caller', () => {
    // The caller's read happened outside the lock; only this one is safe to
    // compare against.
    expect(statementPrecedes(body, 'for update', 'sum(minutes)')).toBe(true);
  });
});

describe('050_serialise_pto_corrections.sql — compare-and-set', () => {
  it('compares the caller-supplied expected state against the locked read', () => {
    expect(body).toContain('p_expected');
  });

  it('returns a `stale` outcome instead of writing when the state moved', () => {
    expect(body).toContain("'stale'");
    expect(
      statementPrecedes(body, "'stale'", 'insert into public.pto_ledger')
    ).toBe(true);
  });

  it('returns outcomes rather than raising, so TS maps them to typed errors', () => {
    expect(body).toContain("'applied'");
    expect(body).toContain("'not_confirmed'");
    expect(body).toContain("'time_off_not_found'");
    expect(body).not.toContain('raise exception');
  });

  it('returns the rows it wrote, so the caller can name an anchor row', () => {
    expect(body).toContain('returning *');
    expect(body).toContain('jsonb_agg');
  });
});

describe('050_serialise_pto_corrections.sql — it cannot forge a row', () => {
  it('writes whichever kind the batch carries — a FIRST marking comes through here too', () => {
    // Hardcoding `adjustment` was right while first markings had their own
    // unlocked path. That path is what produced the 552-minute ledger, so it
    // is gone and `usage` rows arrive here as well. What bounds `kind` is
    // `pto_ledger`'s own check constraint plus 045's per-day unique index —
    // both unchanged, and both now enforced under this lock.
    const insert = body.slice(body.indexOf('insert into public.pto_ledger'));
    expect(insert).toContain('r.kind');
  });

  it('takes household_id and time_off_id from the locked parameters, not the payload', () => {
    const insert = body.slice(body.indexOf('insert into public.pto_ledger'));
    expect(insert).toContain('p_household_id');
    expect(insert).toContain('p_time_off_id');
  });

  it('scopes the ledger read to ONE household — a shared time off has one ledger per family', () => {
    expect(body).toContain('household_id = p_household_id');
  });
});

describe('050_serialise_pto_corrections.sql — the status guard', () => {
  it('refuses a correction when the time off is no longer confirmed', () => {
    expect(body).toContain('p_require_confirmed');
    expect(body).toContain("'confirmed'");
  });

  it('checks the status of the LOCKED row, not a pre-read one', () => {
    expect(statementPrecedes(body, 'for update', 'p_require_confirmed')).toBe(
      true
    );
  });
});

describe('050_serialise_pto_corrections.sql — it weakens nothing', () => {
  it('leaves 045’s per-day usage index completely alone', () => {
    expect(executable).not.toContain(
      'pto_ledger_one_usage_per_time_off_day_idx'
    );
    expect(executable).not.toContain('pto_ledger_one_usage_per_time_off_idx');
  });

  it('leaves the accrual index alone', () => {
    expect(executable).not.toContain('pto_ledger_one_accrual_per_year_idx');
  });

  it('adds NO unique index on adjustment rows — unlimited corrections is the rule', () => {
    expect(executable).not.toContain('create unique index');
    expect(executable).not.toContain("where kind = 'adjustment'");
  });

  it('drops nothing and rewrites no data', () => {
    expect(executable).not.toContain('drop table');
    expect(executable).not.toContain('drop column');
    expect(executable).not.toContain('drop index');
    expect(executable).not.toContain('delete from');
    expect(executable).not.toContain('update public.pto_ledger');
  });

  it('touches no RLS policy', () => {
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain('drop policy');
  });
});

describe('050_serialise_pto_corrections.sql — security', () => {
  it('is SECURITY INVOKER with a pinned search_path, like 024 and 027', () => {
    expect(executable).toContain('security invoker');
    expect(executable).toContain('set search_path = public');
  });

  it('is executable by service_role ONLY', () => {
    const grants = extractFunctionGrantBlock(migrationSql, FN).toLowerCase();
    expect(grants).toContain('from public');
    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
  });

  it('is documented with a comment on the function', () => {
    expect(executable).toContain(`comment on function public.${FN}`);
  });
});

describe('050_serialise_pto_corrections.sql — documentation contract', () => {
  const phrases = [
    'for update',
    'first marking',
    'lost update',
    'compare-and-set',
    'service_role',
  ];
  for (const phrase of phrases) {
    it(`documents "${phrase}" in the header`, () => {
      expect(comments).toContain(phrase);
    });
  }

  it('names the finding it closes', () => {
    expect(comments).toContain('f-b4-2');
  });
});

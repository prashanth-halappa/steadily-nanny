/**
 * @module tests/unit/migration045PtoUsagePerDay.test
 * Pattern A — migration contract for `045_pto_usage_per_day.sql`.
 *
 * Written BEFORE the migration exists (TDD red-first), like 043's and 044's.
 *
 * WHY THIS MIGRATION EXISTS. 043 pinned "one `usage` row per time off per
 * household" as a partial unique index — the 039 pattern, and the right shape
 * when a marking was a single row. The Phase 3/4 review (finding 15b) showed
 * that single row is a defect: a two-week time off marked 80h paid put all
 * 4800 minutes on its START date, so week one priced 80h of PTO and week two
 * priced none, and approving week one froze that lie. Fixing it means one
 * usage row PER COVERED DAY, which the old index forbids outright.
 *
 * The replacement keeps the anti-double-pay guarantee at the grain the
 * marking now has: `(household_id, time_off_id, effective_date)`. Two
 * concurrent "mark paid" taps still write the SAME date set, so the loser
 * still hits 23505 on the first day and still surfaces as
 * `PtoAlreadyMarkedPaidError` — the protection is narrowed, not dropped.
 *
 * ADDITIVE: no column is dropped, no data is deleted or rewritten, and every
 * row that satisfied the old index satisfies the new one (a strictly weaker
 * constraint over a superset of columns). It is safe to apply to a live table
 * with markings already in it.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '045_pto_usage_per_day.sql';
const OLD_INDEX = 'pto_ledger_one_usage_per_time_off_idx';
const NEW_INDEX = 'pto_ledger_one_usage_per_time_off_day_idx';

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
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
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

describe('045_pto_usage_per_day.sql — the index swap', () => {
  it('drops the whole-time-off usage index, idempotently', () => {
    expect(executable).toContain(`drop index if exists public.${OLD_INDEX}`);
  });

  it('creates the per-DAY partial unique index in its place', () => {
    expect(executable).toContain(
      `create unique index if not exists ${NEW_INDEX} on public.pto_ledger (household_id, time_off_id, effective_date) where kind = 'usage'`
    );
  });

  it('keeps the index PARTIAL — adjustment rows stay unlimited per day', () => {
    // Unlimited `adjustment` rows against one (household, time_off) is what
    // makes the mark-paid correction flow and the netted reversal possible
    // (docs/11-MONEY.md §5). A unique index covering them would undo both.
    const newIndexClause = executable.slice(executable.indexOf(NEW_INDEX));
    expect(newIndexClause).toContain("where kind = 'usage'");
    expect(executable).not.toContain("where kind = 'adjustment'");
  });

  it('leaves the accrual index alone', () => {
    expect(executable).not.toContain('pto_ledger_one_accrual_per_year_idx');
  });
});

describe('045_pto_usage_per_day.sql — additive and non-destructive', () => {
  it('drops no column and no table', () => {
    expect(executable).not.toContain('drop table');
    expect(executable).not.toContain('drop column');
  });

  it('writes no data — no insert, update or delete of rows', () => {
    expect(executable).not.toMatch(
      /\b(insert into|update public|delete from)\b/
    );
  });

  it('touches no RLS policy — 043 already settled that stance', () => {
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain('drop policy');
  });
});

describe('045_pto_usage_per_day.sql — documentation contract', () => {
  const phrases = [
    'one usage row per covered day',
    'start date',
    'two concurrent',
    'additive',
    'adjustment',
  ];
  for (const phrase of phrases) {
    it(`documents "${phrase}" in the header`, () => {
      expect(comments).toContain(phrase);
    });
  }

  it('names the review finding it closes', () => {
    expect(comments).toContain('15b');
  });
});

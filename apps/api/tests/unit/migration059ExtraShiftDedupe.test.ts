/**
 * @module tests/unit/migration059ExtraShiftDedupe.test
 * Pattern A — migration contract for `059_extra_shift_dedupe.sql`.
 *
 * Written BEFORE the migration existed, same discipline as 049/052/053/055.
 *
 * WHAT THIS CLOSES: `insertExtraShift` dedupes an extra shift by reading
 * `findExtraShiftInWindow` and inserting when it finds nothing — check-then-act.
 * Two simultaneous creates (a double-tapped "Add extra shift", or an approval
 * re-drive racing the attempt it is repairing) both read empty and both insert,
 * and the family ends up with two identical bookings for one window. The
 * ponytail comment at `shiftRepository.findExtraShiftInWindow` names this index
 * as the real fix.
 *
 * THE IDENTITY: (household_id, carer_id, starts_at, ends_at) — the exact
 * natural key `findExtraShiftInWindow` already queries on, so the DB refuses
 * precisely the rows the app-side pre-check was trying to refuse. Product
 * decision: EXACT duplicates are collapsed; near-duplicates (a window shifted
 * by a minute, a different carer) are legitimately different proposals and stay
 * untouched.
 *
 * THE NULL TRAP: `carer_id` is nullable — an unassigned extra shift is a real
 * shape here (`findExtraShiftInWindow` has an `is('carer_id', null)` branch for
 * it). In a plain unique index Postgres treats NULLs as DISTINCT, so two
 * unassigned duplicates would dedupe against nothing and the hole would stay
 * open for exactly the shape the pre-check does handle. `nulls not distinct`
 * (PG15+, `supabase/config.toml` pins `major_version = 15`) closes it — the
 * same reasoning, and the same precedent, as 053.
 *
 * THE PREDICATE: partial on `kind = 'extra' and status <> 'cancelled'`, matching
 * `findExtraShiftInWindow`'s filters character for character. Materialised
 * pattern shifts (`kind = 'regular'`) legitimately repeat a window across
 * re-materialisation and must never be caught by this; and proposing a
 * replacement for a CANCELLED shift is a new shift, not a duplicate of it.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '059_extra_shift_dedupe.sql';
/** The index name the repository's 23505 translation matches on. */
const INDEX = 'shifts_extra_window_unique';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

// ---------------------------------------------------------------------------
// SQL parsing — `--` comments stripped, `'...'` and `$$ ... $$` respected, so a
// `;` inside a comment or a string does not split a statement in half. Copied
// from `migration053CancellationPaidSplitRemainder.test.ts`, the local
// convention.
// ---------------------------------------------------------------------------

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const newline = sql.indexOf('\n', i);
      i = newline === -1 ? sql.length : newline;
      continue;
    }
    if (sql.startsWith('$$', i)) {
      const close = sql.indexOf('$$', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      current += sql.slice(i, end);
      i = end;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }
    if (sql[i] === ';') {
      statements.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += sql[i];
    i += 1;
  }

  if (current.trim()) statements.push(current);
  return statements;
}

/** Layout-independent form: one space between tokens, none hugging parens. */
function normalise(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

const migrationSql = readMigration(MIGRATION);
const statements = splitStatements(migrationSql).map(normalise).filter(Boolean);
const executable = statements.join('; ').toLowerCase();

const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** The single `create ... index` statement, normalised and lowercased. */
function createIndexStatement(): string {
  const found = statements.filter(s => /^create\s+(unique\s+)?index/i.test(s));
  expect(found).toHaveLength(1);
  return (found[0] ?? '').toLowerCase();
}

describe('059 — the index the app-side pre-check cannot be', () => {
  it('creates exactly one index, and it is UNIQUE', () => {
    // A plain (non-unique) index enforces nothing: two racing inserts would
    // both succeed and the household gets two identical bookings.
    expect(createIndexStatement()).toMatch(/^create unique index/);
  });

  it(`names it "${INDEX}" — the name the repository matches on`, () => {
    // shiftRepository.createShift translates a 23505 naming THIS index into
    // ExtraShiftAlreadyExistsError. Rename the index and that translation
    // silently stops firing, turning the race back into a raw 500.
    expect(createIndexStatement()).toContain(INDEX);
  });

  it('is scoped to public.shifts', () => {
    expect(createIndexStatement()).toContain('on public.shifts');
  });

  it('keys on (household_id, carer_id, starts_at, ends_at), in that order', () => {
    expect(createIndexStatement()).toContain(
      '(household_id, carer_id, starts_at, ends_at)'
    );
  });

  // carer_id is nullable — an unassigned extra shift is a supported shape
  // (findExtraShiftInWindow has an `is('carer_id', null)` branch). Without
  // this, two unassigned duplicates dedupe against nothing. 053 precedent.
  it('declares nulls not distinct, closing the nullable-carer hole', () => {
    expect(createIndexStatement()).toContain('nulls not distinct');
  });

  it('uses the `if not exists` form, the house idempotency pattern', () => {
    expect(createIndexStatement()).toContain(
      'create unique index if not exists'
    );
  });
});

describe('059 — the partial predicate mirrors findExtraShiftInWindow', () => {
  it("restricts to kind = 'extra'", () => {
    // Materialised pattern shifts (kind = 'regular') legitimately repeat a
    // window across re-materialisation; catching them would break the
    // schedule horizon job.
    expect(createIndexStatement()).toContain("where kind = 'extra'");
  });

  it('excludes cancelled shifts, exactly as the lookup does', () => {
    // Proposing a replacement for a shift that was called off is a NEW
    // shift, not a duplicate of it.
    expect(createIndexStatement()).toContain("status <> 'cancelled'");
  });

  // Pinned as an explicit absence: the index must not key on anything that
  // makes two identical proposals distinguishable again (id, created_at,
  // sequence, origin, created_by are all per-attempt values).
  it('keys on nothing that differs between two identical proposals', () => {
    const statement = createIndexStatement();
    for (const column of ['created_at', 'created_by', 'sequence', 'origin']) {
      expect(statement).not.toContain(column);
    }
  });
});

describe('059 — changes nothing else', () => {
  it('touches only indexes', () => {
    expect(executable).not.toContain('create table');
    expect(executable).not.toContain('alter table');
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain('drop policy');
    expect(executable).not.toContain('create trigger');
    expect(executable).not.toContain('create or replace function');
  });

  it('issues no grant or revoke', () => {
    expect(executable).not.toContain('grant ');
    expect(executable).not.toContain('revoke ');
  });

  it('deletes no data', () => {
    expect(executable).not.toContain('delete from');
    expect(executable).not.toContain('truncate');
    expect(executable).not.toContain('drop table');
  });
});

describe('059 — documents the pre-existing-duplicates trap', () => {
  // `create unique index` FAILS on a table that already holds duplicates.
  // Whoever applies this to production needs to know that before they run it,
  // not after — and needs the query to check with.
  it('warns that existing duplicates block the create', () => {
    expect(commentText).toContain('duplicate');
  });
});

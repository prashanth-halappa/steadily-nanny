/**
 * @module tests/unit/migration053CancellationPaidSplitRemainder.test
 * Pattern A — migration contract for `053_cancellation_paid_split_remainder.sql`.
 *
 * Written BEFORE the migration existed, same discipline as 049/052.
 *
 * 039 pinned "at most one cancellation_paid entry per shift" with a partial
 * unique index on `(shift_id)`. That is too strong for the split remainder:
 * when a carer worked the MIDDLE of a cancelled window (11:00-12:00 of an
 * 08:00-16:00 shift), what she is owed is two disjoint intervals, and two rows
 * cannot exist. `recordCancellationPaidEntry` correctly refuses with
 * `CANCELLATION_REMAINDER_FRAGMENTED` rather than writing the larger fragment
 * and underpaying her for the smaller.
 *
 * THE IDENTITY, AND WHY IT IS `(shift_id, clock_in_at)`:
 * 039 exists to stop a double-tapped accept writing two IDENTICAL payable rows
 * for one shift. Two fragments of one remainder are disjoint by construction,
 * so they never share a `clock_in_at` — the composite key permits them while
 * still collapsing a genuine double-tap, which recomputes the same remainder
 * and therefore the same `clock_in_at`.
 *
 * `(shift_id, clock_in_at, clock_out_at)` was considered and REJECTED as
 * strictly weaker: it would permit two rows sharing a `clock_in_at` but
 * differing in `clock_out_at`, which is not a second fragment — it is two
 * overlapping rows paying for the same minutes twice. Adding a column to a
 * unique key only ever admits more rows, and the rows it admits here are
 * exactly the double-pay this index exists to forbid.
 *
 * THE NULL TRAP: `clock_in_at` is nullable (017). In a plain unique index
 * Postgres treats NULLs as DISTINCT, so cancellation rows with a null
 * `clock_in_at` would dedupe against nothing and silently reopen 039's hole
 * for that shape. `nulls not distinct` (PG15+, and `config.toml` pins
 * `major_version = 15`) closes it. Today's sole writer always sets
 * `clock_in_at`, but "the only writer today" is not a constraint.
 *
 * NOT CLOSED HERE: two accepts that compute DIFFERENT remainders for one
 * shift (she clocks in between the two reads) still produce two
 * non-identical, possibly overlapping rows. Forbidding that needs an overlap
 * exclusion constraint (`exclude using gist (shift_id with =,
 * tstzrange(clock_in_at, clock_out_at) with &&)`), which needs the
 * `btree_gist` extension this database does not have. Adding an extension is
 * out of scope for relaxing an index; it is reported as the upgrade path.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '053_cancellation_paid_split_remainder.sql';
/** 039's index, character-for-character — verified against the source file. */
const OLD_INDEX = 'time_entries_one_cancellation_paid_per_shift';

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
// from `migration052LockRemainingClientWrites.test.ts`, the local convention.
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

describe('053 — drops 039’s one-per-shift index', () => {
  it('drops the old index by its exact 039 name', () => {
    expect(executable).toContain(`drop index if exists public.${OLD_INDEX}`);
  });

  it('uses the `if exists` form, the house idempotency pattern', () => {
    const drops = statements.filter(s => /^drop\s+index/i.test(s));
    expect(drops).toHaveLength(1);
    expect(drops[0]?.toLowerCase()).toContain('drop index if exists');
  });

  it('does not recreate anything under the old name', () => {
    expect(createIndexStatement()).not.toContain(OLD_INDEX);
  });
});

describe('053 — the replacement identity is (shift_id, clock_in_at)', () => {
  it('creates exactly one index, and it is UNIQUE', () => {
    // A plain (non-unique) index would enforce nothing at all and would let
    // a double-tapped accept write two identical payable rows — 039's hole,
    // reopened silently.
    expect(createIndexStatement()).toMatch(/^create unique index/);
  });

  it('keys on shift_id and clock_in_at, in that order', () => {
    expect(createIndexStatement()).toContain('(shift_id, clock_in_at)');
  });

  // Pinned as an explicit absence: adding clock_out_at to a unique key only
  // ADMITS more rows, and the rows it admits are two entries sharing a
  // clock_in_at with different ends — overlapping double-pay, not a second
  // fragment.
  it('does NOT include clock_out_at in the key', () => {
    expect(createIndexStatement()).not.toContain('clock_out_at');
  });

  // clock_in_at is nullable (017). Without this, NULLs are DISTINCT and
  // null-clock-in cancellation rows dedupe against nothing.
  it('declares nulls not distinct, closing the nullable-column hole', () => {
    expect(createIndexStatement()).toContain('nulls not distinct');
  });

  it('stays partial, on the same predicate 039 used', () => {
    const statement = createIndexStatement();
    expect(statement).toContain("where kind = 'cancellation_paid'");
    expect(statement).toContain('shift_id is not null');
  });

  // Without the partial predicate this would apply to `worked` rows too, where
  // many entries legitimately share a shift_id.
  it('is scoped to public.time_entries', () => {
    expect(createIndexStatement()).toContain('on public.time_entries');
  });

  it('uses the `if not exists` form', () => {
    expect(createIndexStatement()).toContain(
      'create unique index if not exists'
    );
  });
});

describe('053 — changes nothing else', () => {
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
    expect(executable).not.toContain('update public.');
  });

  it('adds no extension', () => {
    // The overlap-exclusion upgrade would need btree_gist; taking that on is
    // out of scope for relaxing an index.
    expect(executable).not.toContain('create extension');
  });
});

describe('053 — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // Why 039 is being relaxed at all.
    'fragment',
    'underpay',
    // The identity decision and the rejected alternative.
    '(shift_id, clock_in_at)',
    'clock_out_at',
    // The nullable-column trap.
    'nulls not distinct',
    'nullable',
    // What is deliberately still open, so nobody reads this as airtight.
    'btree_gist',
    // The app-side follow-ups this migration obliges.
    'maybesingle',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});

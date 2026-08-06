/**
 * @module tests/unit/migration065PayArrangementEndOnRemoval.test
 * Pattern A — migration contract for `065_pay_arrangement_end_on_removal.sql`.
 *
 * Written BEFORE the migration existed, same discipline as 049/052/053/054/058.
 *
 * WHAT THIS PINS
 * Removal soft-deletes a membership, and rejoining REUSES that row — so
 * without an end date the pay arrangement that was live when the carer left
 * is still the row `effectiveOn` resolves after they come back, at the old
 * rate, silently (docs/11-MONEY.md §10). The owner decision is re-confirm
 * terms: removal end-dates the arrangement, the rejoined carer has none, and
 * the engine's existing no-arrangement arm renders hours with `gross_minor`
 * null (never £0.00 — §4, pinned by I-25).
 *
 * WHY `valid_to date` AND NOT `ended_at timestamptz`:
 *  - `effectiveOn` resolves against a household-LOCAL `YYYY-MM-DD`
 *    (`localDateOf`), never a UTC instant. A `timestamptz` end would have to
 *    be converted per household on every read, and 041's header already warns
 *    that server-UTC "today" is wrong east of UTC.
 *  - Same type and same domain as `valid_from`, so the exclusion predicate is
 *    a pure date comparison that composes with `lte('valid_from', date)`.
 *  - INCLUSIVE: `valid_to` is the last day the terms still price, so a shift
 *    worked on the morning of the removal is still paid.
 *
 * APPEND-ONLY IS NOT BROKEN. `valid_to` is a lifecycle column, not a money
 * field: 041 forbids mutating what a carer was paid, and nothing here does.
 * The CHECK below is what stops the new column being used to rewrite history.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '065_pay_arrangement_end_on_removal.sql';

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

describe('065 — the lifecycle column', () => {
  it('adds a nullable valid_to DATE to pay_arrangements', () => {
    expect(executable).toContain(
      'alter table public.pay_arrangements add column if not exists valid_to date'
    );
  });

  it('does not declare it not null — a live arrangement has no end', () => {
    expect(executable).not.toContain('valid_to date not null');
  });

  it('does not backfill existing rows — every current arrangement stays live', () => {
    expect(executable).not.toContain(
      'update public.pay_arrangements set valid_to'
    );
  });
});

describe('065 — the CHECK is what keeps append-only honest', () => {
  // Without it, `valid_to` could be set BEFORE `valid_from` and retroactively
  // un-pay a week that was already worked and possibly already approved.
  it('constrains valid_to to be on or after valid_from', () => {
    expect(executable).toContain(
      'check (valid_to is null or valid_to >= valid_from)'
    );
  });
});

describe('065 — the header carries the reasoning the next reader needs', () => {
  it('states that valid_to is a lifecycle column, not a money field', () => {
    expect(commentText).toContain('lifecycle');
    expect(commentText).toContain('append-only');
  });

  it('explains the valid_to-over-ended_at choice', () => {
    expect(commentText).toContain('ended_at');
    expect(commentText).toContain('local');
  });

  it('says valid_to is inclusive, so the removal day still prices', () => {
    expect(commentText).toContain('inclusive');
  });

  it('carries a pre-deploy check query', () => {
    expect(commentText).toContain('pre-deploy');
    expect(commentText).toContain('select');
  });

  it('records that historical weeks before the end must still price', () => {
    expect(commentText).toContain('historical');
  });
});

/**
 * @module tests/unit/migration104ScheduleInvariants.test
 * Pattern A — migration contract for `104_schedule_invariants.sql`
 * (audit S3 and S4a).
 *
 * S3: "one accepted pattern per (household, carer)" has been application
 * logic since 014. 062's header records that production once held windows
 * with THREE identical live recurring shifts from three different patterns
 * for one carer; the repair added a unique index on `shifts`, never on
 * `schedule_patterns`. The net under the root invariant is still missing.
 *
 * S4a: inside one household the only refusing checks test window EQUALITY
 * (059, 062), so 09:00–17:00 and 10:00–12:00 for the same carer both insert
 * cleanly. An exclusion constraint over `tstzrange` is what turns equality
 * into overlap — 055 already installed `btree_gist` for exactly this.
 *
 * Cross-household overlap stays ADVISORY (the `v_busy_blocks` warning path)
 * and is deliberately out of scope here; the constraint is keyed on
 * `household_id` so it can never bite it.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '104_schedule_invariants.sql';

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

describe('104 — S3: one accepted pattern per (household, carer)', () => {
  it('creates the partial unique index on schedule_patterns', () => {
    expect(executable).toContain(
      "create unique index if not exists schedule_patterns_one_accepted_idx on public.schedule_patterns (household_id, carer_id) where status = 'accepted' and carer_id is not null"
    );
  });

  it('leaves 062’s shifts index alone — the net under it still holds', () => {
    expect(executable).not.toContain('drop index');
    expect(executable).not.toContain('shifts_recurring_window_unique');
  });

  it('carries a pre-flight duplicate check in the header', () => {
    expect(commentText).toContain('from public.schedule_patterns');
    expect(commentText).toContain('having count(*) > 1');
  });
});

describe('104 — cover / parent_cover dedupe, in the 059/062 shape', () => {
  for (const [kind, index] of [
    ['cover', 'shifts_cover_window_unique'],
    ['parent_cover', 'shifts_parent_cover_window_unique'],
  ] as const) {
    it(`creates ${index} keyed on the natural window`, () => {
      expect(executable).toContain(
        `create unique index if not exists ${index} on public.shifts (household_id, carer_id, starts_at, ends_at) nulls not distinct where kind = '${kind}' and status <> 'cancelled'`
      );
    });
  }

  it('uses nulls not distinct — parent_cover carries a NULL carer_id', () => {
    expect(commentText).toContain('nulls not distinct');
    expect(commentText).toContain('parent_cover');
  });
});

describe('104 — S4a: same-carer overlap inside one household is refused', () => {
  it('installs btree_gist idempotently (055 already did)', () => {
    expect(executable).toContain('create extension if not exists btree_gist');
  });

  it('drops any prior constraint of the same name before adding it', () => {
    expect(executable).toContain(
      'alter table public.shifts drop constraint if exists shifts_carer_window_excl'
    );
    expect(
      executable.indexOf('drop constraint if exists shifts_carer_window_excl')
    ).toBeLessThan(
      executable.indexOf('add constraint shifts_carer_window_excl')
    );
  });

  it('adds the exclusion constraint over a half-open tstzrange', () => {
    expect(executable).toContain(
      "add constraint shifts_carer_window_excl exclude using gist ( household_id with =, carer_id with =, tstzrange(starts_at, ends_at, '[)') with && ) where ( carer_id is not null and status not in ('cancelled', 'declined') )"
    );
  });

  it('is scoped to ONE household — cross-household stays advisory', () => {
    expect(executable).toContain('household_id with =');
    expect(commentText).toContain('cross-household');
  });

  it('exempts the unassigned and the settled-negative statuses', () => {
    expect(executable).toContain('carer_id is not null');
    expect(executable).toContain("status not in ('cancelled', 'declined')");
  });

  it('creates the unique indexes BEFORE the exclusion constraint (OID order)', () => {
    expect(executable.indexOf('shifts_cover_window_unique')).toBeLessThan(
      executable.indexOf('shifts_carer_window_excl')
    );
    expect(commentText).toContain('oid order');
    expect(commentText).toContain('23505');
    expect(commentText).toContain('23p01');
  });

  it('records the pre-flight self-join and the manual repair recipe', () => {
    expect(commentText).toContain('no not valid form');
    expect(commentText).toContain('join public.shifts b');
  });
});

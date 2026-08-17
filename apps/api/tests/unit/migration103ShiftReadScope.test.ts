/**
 * @module tests/unit/migration103ShiftReadScope.test
 * Pattern A — migration contract for `103_shift_read_scope.sql` (audit S1).
 *
 * 015 gave all four shift tables `is_household_member` read policies, and 040
 * repointed them at `can_read_household` — the same predicate, role-blind and
 * carer-blind. A SECOND NANNY and a HELPER therefore read every carer's
 * shifts, the children on them, every change request, and the whole
 * free-text day thread. That is the exact shape 087 removed from `timesheets`
 * and `time_entries`, and 103 applies 087's argument to the calendar.
 *
 * The service gate moves in the same commit (`assertShiftReader`) — this file
 * pins the database half, comment-stripped so a comment can never satisfy it.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '103_shift_read_scope.sql';

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

/** The predicate 067/044/087 already use, applied here to `shifts` itself. */
const SHIFT_READ_CIRCLE =
  'private.can_write_household(household_id) or carer_id = (select auth.uid())';

/** The same circle, reached through the owning shift row. */
const VIA_SHIFT =
  'exists ( select 1 from public.shifts s where s.id = shift_id and (private.can_write_household(s.household_id) or s.carer_id = (select auth.uid())) )'.replace(
    /\s+/g,
    ' '
  );

function selectPredicate(table: string): string | undefined {
  const policy = new RegExp(
    `create policy "[^"]+" on public\\.${table} for select using \\(([\\s\\S]*?)\\)\\s*;`
  ).exec(`${executable};`);
  return policy?.[1]?.replace(/\s+/g, ' ').trim();
}

describe('103 — the shift tables leave the household-wide read circle', () => {
  it('drops 015/040’s wide select policy on shifts before recreating one', () => {
    expect(executable).toContain(
      'drop policy if exists "members can view shifts" on public.shifts'
    );
    expect(
      executable.indexOf('drop policy if exists "members can view shifts"')
    ).toBeLessThan(executable.indexOf('on public.shifts for select using'));
  });

  it('gives shifts the 087 predicate: parents, or the assigned carer', () => {
    expect(selectPredicate('shifts')).toBe(SHIFT_READ_CIRCLE);
  });

  for (const table of ['shift_children', 'shift_change_requests'] as const) {
    it(`drops ${table}'s wide select policy`, () => {
      expect(executable).toContain(`on public.${table}`);
      expect(executable).toContain('drop policy if exists');
    });

    it(`reaches the same circle through the owning shift row for ${table}`, () => {
      expect(selectPredicate(table)).toBe(VIA_SHIFT);
    });
  }

  it('lets shift_events be read by parents, the actor, or the shift’s carer', () => {
    const predicate = selectPredicate('shift_events');
    expect(predicate).toBe(
      [
        'private.can_write_household(household_id)',
        'or actor_id = (select auth.uid())',
        'or ( shift_id is not null and exists (',
        'select 1 from public.shifts s',
        'where s.id = shift_id and s.carer_id = (select auth.uid()) ) )',
      ]
        .join(' ')
        .replace(/\s+/g, ' ')
    );
  });

  it('keeps day-level rows (shift_id null) parents-only, and says why', () => {
    expect(executable).toContain('shift_id is not null');
    expect(commentText).toContain('uncovered_care');
    expect(commentText).toContain('timesheet_reopened');
  });

  it('drops can_read_household from all four tables', () => {
    expect(executable).not.toContain('can_read_household');
  });

  it('keeps the helper call BARE (040 trap 2 — no (select …) wrapper)', () => {
    expect(executable).not.toContain('(select private.can_write_household');
  });

  it('keeps 018’s initplan form on every carer/actor self-arm', () => {
    expect(executable).toContain('(select auth.uid())');
    expect(executable).not.toContain('auth.uid() =');
  });

  it('adds no insert/update/delete policy — the write policies are untouched', () => {
    expect(executable).not.toContain('for insert');
    expect(executable).not.toContain('for update');
    expect(executable).not.toContain('for delete');
    expect(executable).not.toContain('for all');
  });

  it('records the accepted PostgREST consequence for a nanny', () => {
    expect(commentText).toContain('parent_cover');
    expect(commentText).toContain('service role');
  });
});

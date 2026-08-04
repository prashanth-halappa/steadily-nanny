/**
 * Pattern A — consent demotion in apply_parent_shift_edit (migration 034).
 *
 * Deliberately non-greedy: an inverted then/else (demote on note-only, leave
 * status alone on time change) must fail. Complements the pure predicate in
 * `parentEditDemotion.test.ts`.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  extractFunctionBody,
  extractFunctionGrantBlock,
  statementPrecedes,
} from '../../../../helpers/sqlMigrationHelpers';

const migrationsDir = join(
  import.meta.dir,
  '../../../../../../../supabase/migrations'
);

/**
 * Exact CASE arm from migration 034 — order of when/then/else is load-bearing.
 * Inverting then/else or dropping the confirmed guard must break this.
 */
const DEMOTE_CASE =
  /status\s*=\s*case\s+when\s*\(\s*p_set_starts_at\s+or\s+p_set_ends_at\s*\)\s+and\s+v_locked\.status\s*=\s*'confirmed'\s+then\s*'pending'\s+else\s+status\s+end/i;

describe('034_parent_shift_edit_demote_on_time_change.sql', () => {
  async function read034(): Promise<string> {
    return Bun.file(
      join(migrationsDir, '034_parent_shift_edit_demote_on_time_change.sql')
    ).text();
  }

  it('demotes confirmed → pending when times change, not on note-only', async () => {
    const body = extractFunctionBody(
      await read034(),
      'apply_parent_shift_edit'
    );

    // Tight CASE — fails if then/else inverted or time flags dropped from when.
    expect(body).toMatch(DEMOTE_CASE);

    // Note-only path is the else arm (preserve status), not a then 'pending'.
    expect(body).not.toMatch(
      /when\s+not\s*\(\s*p_set_starts_at\s+or\s+p_set_ends_at\s*\)\s+then\s*'pending'/i
    );
    expect(body).not.toMatch(/then\s+status\s+else\s+'pending'/i);
  });

  it('still locks FOR UPDATE and derives sequence under lock', async () => {
    const body = extractFunctionBody(
      await read034(),
      'apply_parent_shift_edit'
    );
    expect(body).toContain('for update');
    statementPrecedes(body, 'for update', 'update public.shifts');
    expect(body).toContain('v_locked.sequence + 1');
  });

  it('records status in the shift_updated audit before/after', async () => {
    const body = extractFunctionBody(
      await read034(),
      'apply_parent_shift_edit'
    );
    expect(body).toContain('v_locked.status');
    expect(body).toContain('v_shift.status');
  });

  it('is SECURITY INVOKER with service_role-only execute', async () => {
    const sql = await read034();
    expect(sql).toContain('security invoker');
    const grants = extractFunctionGrantBlock(sql, 'apply_parent_shift_edit');
    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
    expect(grants).toContain('uuid');
  });
});

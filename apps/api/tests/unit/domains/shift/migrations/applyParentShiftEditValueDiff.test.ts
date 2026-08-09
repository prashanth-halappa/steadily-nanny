/**
 * Pattern A — consent demotion value diff in apply_parent_shift_edit (migration 071).
 *
 * Migration 034 used presence flags; 071 compares locked-row instants with
 * `is distinct from`. Complements the pure predicate in `parentEditDemotion.test.ts`.
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
 * Exact CASE arm from migration 071 — order of when/then/else is load-bearing.
 * Reverting to 034's flag-only when-clause must break this.
 */
const DEMOTE_CASE =
  /status\s*=\s*case\s+when\s*\(\s*\(\s*p_set_starts_at\s+and\s+p_starts_at\s+is\s+distinct\s+from\s+v_locked\.starts_at\s*\)\s+or\s*\(\s*p_set_ends_at\s+and\s+p_ends_at\s+is\s+distinct\s+from\s+v_locked\.ends_at\s*\)\s*\)\s+and\s+v_locked\.status\s*=\s*'confirmed'\s+then\s*'pending'\s+else\s+status\s+end/i;

describe('071_parent_shift_edit_value_diff.sql', () => {
  async function read071(): Promise<string> {
    return Bun.file(
      join(migrationsDir, '071_parent_shift_edit_value_diff.sql')
    ).text();
  }

  it('demotes confirmed → pending only when instants actually change', async () => {
    const body = extractFunctionBody(
      await read071(),
      'apply_parent_shift_edit'
    );

    expect(body).toMatch(DEMOTE_CASE);

    // Must not use 034's flag-only predicate.
    expect(body).not.toMatch(
      /when\s*\(\s*p_set_starts_at\s+or\s+p_set_ends_at\s*\)\s+and\s+v_locked\.status\s*=\s*'confirmed'/i
    );
  });

  it('still locks FOR UPDATE and derives sequence under lock', async () => {
    const body = extractFunctionBody(
      await read071(),
      'apply_parent_shift_edit'
    );
    expect(body).toContain('for update');
    statementPrecedes(body, 'for update', 'update public.shifts');
    expect(body).toContain('v_locked.sequence + 1');
  });

  it('records status in the shift_updated audit before/after', async () => {
    const body = extractFunctionBody(
      await read071(),
      'apply_parent_shift_edit'
    );
    expect(body).toContain('v_locked.status');
    expect(body).toContain('v_shift.status');
  });

  it('is SECURITY INVOKER with service_role-only execute', async () => {
    const sql = await read071();
    expect(sql).toContain('security invoker');
    const grants = extractFunctionGrantBlock(sql, 'apply_parent_shift_edit');
    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
    expect(grants).toContain('uuid');
  });
});

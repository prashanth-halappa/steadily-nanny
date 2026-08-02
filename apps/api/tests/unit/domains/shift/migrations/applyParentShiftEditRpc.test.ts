/**
 * @module tests/unit/domains/shift/migrations/applyParentShiftEditRpc.test
 * Pattern A — permission contract for apply_parent_shift_edit (D23).
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const migrationPath = join(
  import.meta.dir,
  '../../../../../../../supabase/migrations/019_apply_parent_shift_edit.sql'
);

describe('019_apply_parent_shift_edit.sql', () => {
  it('is SECURITY INVOKER, revokes anon/authenticated, grants service_role only', async () => {
    const sql = await Bun.file(migrationPath).text();
    expect(sql).toContain('security invoker');
    expect(sql).toContain(
      'revoke all on function public.apply_parent_shift_edit'
    );
    expect(sql).toContain('from anon');
    expect(sql).toContain('from authenticated');
    expect(sql).toContain(
      'grant execute on function public.apply_parent_shift_edit'
    );
    expect(sql).toContain('to service_role');
    expect(sql).toContain("'shift_updated'");
  });
});

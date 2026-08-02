/**
 * @module tests/unit/domains/shift/migrations/applyParentShiftEditRpc.test
 * Pattern A — permission + serialisation contract for apply_parent_shift_edit (D23).
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

/** The 12-type signature 019 created and 027 replaced — 031's drop target. */
const OLD_SIGNATURE_TYPES =
  'uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text, integer, jsonb, jsonb';

describe('027_serialise_parent_shift_edit.sql', () => {
  it('locks shift FOR UPDATE and derives sequence from locked row, not p_sequence', async () => {
    const sql = await Bun.file(
      join(migrationsDir, '027_serialise_parent_shift_edit.sql')
    ).text();
    const body = extractFunctionBody(sql, 'apply_parent_shift_edit');

    // NOT a `[\s\S]*` regex: that only proves a `for update` exists SOMEWHERE
    // after A `from public.shifts`, so it still passes on a body where the
    // lock has drifted BELOW the mutation. Assert the ordering itself.
    expect(body).toContain('for update');
    statementPrecedes(body, 'for update', 'update public.shifts');
    expect(body).toContain('v_locked.sequence + 1');
    expect(body).not.toMatch(/sequence\s*=\s*p_sequence/i);
    expect(body).toContain("'shift_updated'");
  });

  it('is SECURITY INVOKER, revokes anon/authenticated, grants service_role only', async () => {
    const sql = await Bun.file(
      join(migrationsDir, '027_serialise_parent_shift_edit.sql')
    ).text();
    expect(sql).toContain('security invoker');
    const grants = extractFunctionGrantBlock(sql, 'apply_parent_shift_edit');

    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
    expect(grants).not.toContain('to authenticated');
  });
});

describe('031_derive_parent_shift_edit_audit_in_sql.sql', () => {
  async function read031(): Promise<string> {
    return Bun.file(
      join(migrationsDir, '031_derive_parent_shift_edit_audit_in_sql.sql')
    ).text();
  }

  it('derives before/after from the LOCKED row, never from caller-supplied snapshots', async () => {
    const body = extractFunctionBody(
      await read031(),
      'apply_parent_shift_edit'
    );

    statementPrecedes(body, 'for update', 'update public.shifts');
    expect(body).toContain('v_locked.sequence + 1');

    // The audit record is built from v_locked (true pre-state under lock) and
    // v_shift (the row the UPDATE actually returned) — not from parameters.
    expect(body).toContain("'before'");
    expect(body).toContain("'after'");
    expect(body).toContain('v_locked.starts_at');
    expect(body).toContain('v_locked.sequence');
    expect(body).toContain('v_shift.sequence');
    expect(body).toContain("'shift_updated'");
    expect(body).toContain('insert into public.shift_events');

    // No client-computed audit input survives anywhere in the body.
    expect(body).not.toContain('p_sequence');
    expect(body).not.toContain('p_before');
    expect(body).not.toContain('p_after');
  });

  it('drops the old 12-arg overload before recreating, so the racy one cannot stay callable', async () => {
    const sql = await read031();

    expect(sql).toContain(
      `drop function if exists public.apply_parent_shift_edit(\n  ${OLD_SIGNATURE_TYPES}\n);`
    );
    statementPrecedes(
      sql,
      'drop function if exists public.apply_parent_shift_edit',
      'create or replace function public.apply_parent_shift_edit'
    );
    // The new signature drops p_sequence/p_before/p_after entirely.
    expect(sql).not.toContain('p_sequence integer');
    expect(sql).not.toContain('p_before jsonb');
    expect(sql).not.toContain('p_after jsonb');
  });

  it('re-grants and argument-qualifies the comment for the NEW signature', async () => {
    const sql = await read031();
    expect(sql).toContain('security invoker');

    // A new overload inherits NO grants — the full block must be repeated
    // with the new type list (no `integer`/`jsonb` any more).
    const grants = extractFunctionGrantBlock(sql, 'apply_parent_shift_edit');
    expect(grants).toContain('from public');
    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
    expect(grants).not.toContain('to authenticated');
    expect(grants).not.toContain('integer');
    expect(grants).not.toContain('jsonb');

    // Unqualified `comment on function` would fail 42725 if any overload
    // lingered; qualify it regardless so the statement names one function.
    expect(sql).toMatch(
      /comment on function public\.apply_parent_shift_edit\s*\(\s*uuid/i
    );
  });
});

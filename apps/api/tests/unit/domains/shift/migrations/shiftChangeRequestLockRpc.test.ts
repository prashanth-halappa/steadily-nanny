/**
 * @module tests/unit/domains/shift/migrations/shiftChangeRequestLockRpc.test
 * Pattern A — permission + concurrency contract for shift-change-request RPCs (G4).
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

async function readMigration(filename: string): Promise<string> {
  return Bun.file(join(migrationsDir, filename)).text();
}

/**
 * The regression a lock assertion exists to catch: the shift row is read and
 * locked AFTER the mutation it is supposed to serialise. Any assertion that
 * spans the whole body (`/from public\.shifts[\s\S]*for update/`) still
 * matches this, which is why the real tests below use `statementPrecedes`.
 */
const LOCK_BELOW_MUTATION = `
  update public.shift_change_requests
  set status = 'accepted'
  where id = p_change_request_id;

  select * into v_shift
  from public.shifts
  where id = v_request.shift_id
  for update;
`;

describe('lock-position assertion', () => {
  it('rejects a body that locks the shift below the mutation', () => {
    expect(() =>
      statementPrecedes(
        LOCK_BELOW_MUTATION,
        'for update',
        'update public.shift_change_requests'
      )
    ).toThrow();
  });
});

describe('accept_shift_change_request (029)', () => {
  it('locks the shift, rechecks immutability, CAS-accepts, supersedes siblings, applies with v_shift.sequence + 1, inserts p_events', async () => {
    const sql = await readMigration(
      '029_accept_shift_change_request_events.sql'
    );
    const body = extractFunctionBody(sql, 'accept_shift_change_request');

    expect(sql).toContain('security invoker');
    // The lock must sit ABOVE every write it serialises, not merely somewhere
    // in the body — see the `lock-position assertion` guard above.
    statementPrecedes(
      body,
      'for update',
      'update public.shift_change_requests'
    );
    statementPrecedes(body, 'for update', 'update public.shifts');
    expect(body).toContain('time_entries');
    expect(body).toContain("'superseded'");
    expect(body).toContain('v_shift.sequence + 1');
    expect(body).not.toMatch(/sequence\s*=\s*p_sequence/i);
    expect(body).toContain('p_events');
    expect(body).toContain('insert into public.shift_events');
    expect(body).toContain("'change_request_superseded'");

    const idNeFilter = body.match(/id\s*<>\s*p_change_request_id/gi) ?? [];
    expect(idNeFilter.length).toBe(1);

    expect(body).toContain("'accepted'");
    expect(body).toContain("'not_pending'");
    expect(body).toContain("'shift_immutable'");
    expect(body).toContain("'shift_not_found'");
  });

  // Supplementary to the service-level contract test in
  // shiftChangeRequestCommandService.test.ts ("sends no local_date on
  // accept-path events") — this pins the other half of that contract: the RPC
  // really is the thing that resolves the day thread, and it resolves it from
  // the POST-mutation row.
  it('resolves each event day thread from the post-mutation shift row, never from the caller', async () => {
    const sql = await readMigration(
      '029_accept_shift_change_request_events.sql'
    );
    const body = extractFunctionBody(sql, 'accept_shift_change_request');

    // Events are inserted after the shift mutation, so `v_shift` (reassigned
    // by `returning * into v_shift`) carries the local_date the
    // sync_shifts_local_date trigger recomputed — the post-update day.
    statementPrecedes(
      body,
      'update public.shifts',
      'insert into public.shift_events'
    );
    expect(body).toContain('v_shift.local_date');
    // A caller-supplied day would be silently discarded; none is accepted.
    expect(body).not.toContain("e->>'local_date'");
  });

  it('revokes anon/authenticated and grants service_role only', async () => {
    const sql = await readMigration(
      '029_accept_shift_change_request_events.sql'
    );
    const grants = extractFunctionGrantBlock(
      sql,
      'accept_shift_change_request'
    );

    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
    expect(grants).not.toContain('to authenticated');
  });
});

describe('open_shift_change_request (028)', () => {
  it('locks the shift, rechecks immutability, supersedes ALL pending before insert', async () => {
    const sql = await readMigration(
      '028_open_shift_change_request_immutability.sql'
    );
    const body = extractFunctionBody(sql, 'open_shift_change_request');

    expect(sql).toContain('security invoker');
    statementPrecedes(
      body,
      'for update',
      'update public.shift_change_requests'
    );
    statementPrecedes(
      body,
      'for update',
      'insert into public.shift_change_requests'
    );
    expect(body).toContain('time_entries');
    expect(body).toContain("'shift_immutable'");
    expect(body).toContain("'superseded'");
    statementPrecedes(
      body,
      "'superseded'",
      'insert into public.shift_change_requests'
    );
  });

  it('revokes anon/authenticated and grants service_role only', async () => {
    const sql = await readMigration(
      '028_open_shift_change_request_immutability.sql'
    );
    const grants = extractFunctionGrantBlock(sql, 'open_shift_change_request');

    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
    expect(grants).not.toContain('to authenticated');
  });
});

const MIGRATION_030 = '030_open_shift_change_request_events.sql';

describe('open_shift_change_request (030) — event atomicity', () => {
  it('inserts the created + superseded day-thread events inside the same transaction', async () => {
    const sql = await readMigration(MIGRATION_030);
    const body = extractFunctionBody(sql, 'open_shift_change_request');

    expect(sql).toContain('security invoker');
    expect(sql).toContain('set search_path = public');

    // Lock, then supersede, then insert the new row, then write the audit
    // trail — all under the one lock, all in the one transaction.
    statementPrecedes(
      body,
      'for update',
      'update public.shift_change_requests'
    );
    statementPrecedes(
      body,
      'update public.shift_change_requests',
      'insert into public.shift_change_requests'
    );
    statementPrecedes(
      body,
      'insert into public.shift_change_requests',
      'insert into public.shift_events'
    );

    expect(body).toContain("'change_request_created'");
    expect(body).toContain("'change_request_superseded'");
    // Both event kinds name ids the caller cannot know before the call: the
    // row this RPC inserts, and the rows its CTE closed.
    expect(body).toContain('v_created.id');
    // Day thread resolved from the locked row, consistent with 029.
    expect(body).toContain('v_shift.local_date');
  });

  it('keeps the 6-argument identity so no second overload is created', async () => {
    const sql = await readMigration(MIGRATION_030);
    const body = extractFunctionBody(sql, 'open_shift_change_request');

    // Deriving the events in SQL means the argument list is unchanged, so
    // `create or replace` rebinds the existing function in place. Growing the
    // signature without a matching `drop function` would leave two overloads
    // and every PostgREST call would fail with 42725 (function is not unique).
    expect(body).not.toContain('p_events');
    expect(sql).toContain(
      'public.open_shift_change_request(\n  p_shift_id uuid,\n  p_requested_by uuid,\n  p_kind text,\n  p_proposed_starts_at timestamptz,\n  p_proposed_ends_at timestamptz,\n  p_message text\n)'
    );
  });

  it('restates revoke-from-public/anon/authenticated and grants service_role only', async () => {
    const sql = await readMigration(MIGRATION_030);
    const grants = extractFunctionGrantBlock(sql, 'open_shift_change_request');

    expect(grants).toContain('from public');
    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
    expect(grants).not.toContain('to authenticated');
  });

  it('documents the day-thread semantics 029 left undocumented', async () => {
    const sql = await readMigration(MIGRATION_030);

    // 029 is already applied and must not be edited, so the comment it should
    // have carried is (re)stated here — qualified with its argument list.
    expect(sql).toContain(
      'comment on function public.accept_shift_change_request('
    );
    expect(sql).toMatch(/local midnight/i);
  });
});

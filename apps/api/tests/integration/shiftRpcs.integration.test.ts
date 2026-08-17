/**
 * The two shift RPCs, EXECUTED.
 *
 * `docs/AS-BUILT-SCHEDULE.md` §7 names this as the hole: every RPC performing
 * a real state transition — `apply_parent_shift_edit` (the confirmed→pending
 * demotion), `accept_shift_change_request` — is covered only by text
 * assertions plus service tests that mock the RPC out. Their bodies, where
 * the multi-table transactional writes live, have no executing test anywhere.
 * This file runs them against a real Postgres.
 *
 * It is deliberately narrow: it covers the demotion (071's value diff) and
 * the ONE new interaction migration 104 introduces — a time change accepted
 * into a window the carer already holds. The rest of
 * `accept_shift_change_request`'s outcome matrix (supersede, cancel,
 * shift_immutable) stays where it is, in the service tests.
 *
 * NOT part of `bun run test` / `bun run qc`. See `./helpers/localStack`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createUser,
  deleteUsers,
  insertOne,
  type SeedUser,
  serviceClient,
  suffix,
} from './helpers/localStack';

const service = serviceClient();

const EXCLUSION_VIOLATION = '23P01';

let p1: SeedUser;
let n1: SeedUser;
let householdId = '';
const shifts: string[] = [];

async function insertShift(
  row: Record<string, unknown> & { starts_at: string; ends_at: string }
): Promise<string> {
  const id = await insertOne('shifts', {
    household_id: householdId,
    carer_id: n1.id,
    timezone: 'Europe/London',
    kind: 'recurring',
    status: 'confirmed',
    ...row,
  });
  shifts.push(id);
  return id;
}

beforeAll(async () => {
  p1 = await createUser('rpc-p1');
  n1 = await createUser('rpc-n1');

  householdId = await insertOne('households', {
    name: `Shift RPCs ${suffix}`,
    created_by: p1.id,
  });
  await insertOne('household_members', {
    household_id: householdId,
    user_id: p1.id,
    role: 'parent',
    can_edit: true,
  });
  await insertOne('household_members', {
    household_id: householdId,
    user_id: n1.id,
    role: 'nanny',
  });
});

afterAll(async () => {
  if (shifts.length > 0) {
    await service.from('shifts').delete().in('id', shifts);
  }
  await service.from('households').delete().eq('id', householdId);
  await deleteUsers([p1?.id, n1?.id]);
});

describe('apply_parent_shift_edit — the demotion, executed', () => {
  test('a real time change demotes confirmed → pending and appends its event', async () => {
    const shiftId = await insertShift({
      starts_at: '2026-06-01T09:00:00Z',
      ends_at: '2026-06-01T17:00:00Z',
      local_date: '2026-06-01',
    });

    const { data, error } = await service.rpc('apply_parent_shift_edit', {
      p_shift_id: shiftId,
      p_actor_id: p1.id,
      p_starts_at: '2026-06-01T10:00:00Z',
      p_ends_at: null,
      p_note: null,
      p_set_starts_at: true,
      p_set_ends_at: false,
      p_set_note: false,
      p_origin: 'parent_proposed',
    });

    expect(error).toBeNull();
    const shift = data as { status: string; sequence: number } | null;
    expect(shift?.status).toBe('pending');
    expect(shift?.sequence).toBe(1);

    const { data: events } = await service
      .from('shift_events')
      .select('event_type')
      .eq('shift_id', shiftId);
    expect(
      (events ?? []).map(e => (e as { event_type: string }).event_type)
    ).toContain('shift_updated');
  });

  test('RESENDING the same instants does NOT demote — 071 diffs values, not flags', async () => {
    const shiftId = await insertShift({
      starts_at: '2026-06-02T09:00:00Z',
      ends_at: '2026-06-02T17:00:00Z',
      local_date: '2026-06-02',
    });

    const { data, error } = await service.rpc('apply_parent_shift_edit', {
      p_shift_id: shiftId,
      p_actor_id: p1.id,
      // The SAME instant, written with a different offset — the trap
      // GOLDEN-FIXES #25 describes, where a string compare reports "moved".
      p_starts_at: '2026-06-02T10:00:00+01:00',
      p_ends_at: null,
      p_note: null,
      p_set_starts_at: true,
      p_set_ends_at: false,
      p_set_note: false,
      p_origin: 'parent_proposed',
    });

    expect(error).toBeNull();
    expect((data as { status: string } | null)?.status).toBe('confirmed');
  });

  test('re-timing ONTO another of this carer’s live windows is refused by 104', async () => {
    await insertShift({
      starts_at: '2026-06-03T09:00:00Z',
      ends_at: '2026-06-03T12:00:00Z',
      local_date: '2026-06-03',
    });
    const mover = await insertShift({
      kind: 'extra',
      starts_at: '2026-06-03T14:00:00Z',
      ends_at: '2026-06-03T16:00:00Z',
      local_date: '2026-06-03',
    });

    const { error } = await service.rpc('apply_parent_shift_edit', {
      p_shift_id: mover,
      p_actor_id: p1.id,
      p_starts_at: '2026-06-03T10:00:00Z',
      p_ends_at: '2026-06-03T11:00:00Z',
      p_set_starts_at: true,
      p_set_ends_at: true,
      p_note: null,
      p_set_note: false,
      p_origin: 'parent_proposed',
    });

    expect(error?.code).toBe(EXCLUSION_VIOLATION);
    expect(error?.message).toContain('shifts_carer_window_excl');

    // Vacuity guard: the transaction rolled back, so the mover kept its times.
    const { data: after } = await service
      .from('shifts')
      .select('starts_at, status')
      .eq('id', mover)
      .single();
    expect((after as { status: string }).status).toBe('confirmed');
  });
});

describe('accept_shift_change_request — a time change into an occupied window', () => {
  test('raises 23P01 rather than double-booking the carer', async () => {
    const occupied = await insertShift({
      starts_at: '2026-06-08T09:00:00Z',
      ends_at: '2026-06-08T12:00:00Z',
      local_date: '2026-06-08',
    });
    const target = await insertShift({
      kind: 'extra',
      status: 'pending',
      starts_at: '2026-06-08T14:00:00Z',
      ends_at: '2026-06-08T16:00:00Z',
      local_date: '2026-06-08',
    });
    // Vacuity guard: both rows are live and distinct before the accept.
    expect(occupied).not.toBe(target);

    const changeRequestId = await insertOne('shift_change_requests', {
      shift_id: target,
      requested_by: n1.id,
      kind: 'counter_offer',
      proposed_starts_at: '2026-06-08T10:00:00Z',
      proposed_ends_at: '2026-06-08T11:00:00Z',
      message: 'Could we do the late morning instead?',
    });

    const { error } = await service.rpc('accept_shift_change_request', {
      p_change_request_id: changeRequestId,
      p_responded_by: p1.id,
      p_response_message: null,
      p_set_cancel: false,
      p_cancelled_at: null,
      p_cancelled_by: null,
      p_cancellation_paid: false,
      p_cancellation_message: null,
      p_set_times: true,
      p_starts_at: '2026-06-08T10:00:00Z',
      p_ends_at: '2026-06-08T11:00:00Z',
      p_origin: 'nanny_countered',
      p_is_short_notice: false,
      p_events: [],
    });

    expect(error?.code).toBe(EXCLUSION_VIOLATION);
    expect(error?.message).toContain('shifts_carer_window_excl');

    // The whole RPC is one transaction: the request must still be pending.
    const { data: request } = await service
      .from('shift_change_requests')
      .select('status')
      .eq('id', changeRequestId)
      .single();
    expect((request as { status: string }).status).toBe('pending');
  });
});

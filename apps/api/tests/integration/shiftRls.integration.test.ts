/**
 * Migration 103's shift read scope — against a REAL Postgres with REAL user
 * JWTs, driving PostgREST exactly the way an attacker holding the bundled
 * anon key would (F-B10-2, and the same argument as `rls.integration.test.ts`).
 *
 * Every other assertion about 103 in this repo greps SQL text. This is the
 * only thing that proves the four policies behave: that a SECOND NANNY cannot
 * read the first nanny's shifts, children, change requests or day thread, and
 * that a HELPER reads nothing at all.
 *
 * NOT part of `bun run test` / `bun run qc` — see `./helpers/localStack` and
 * `docs/09-TESTING.md` for how to run this tier.
 *
 * VACUITY GUARDS. Every zero-row assertion is paired with proof that the row
 * it targeted really exists (the service client, which bypasses RLS, can see
 * it) AND that the policy is not simply refusing everyone (the parent, who
 * should see it, does). Without both, a typo'd uuid would make the whole file
 * pass.
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

/** The service client bypasses RLS — proof the row a denial targeted exists. */
async function serviceSees(table: string, id: string): Promise<number> {
  const { data, error } = await service.from(table).select('id').eq('id', id);
  if (error) {
    throw new Error(`service select ${table} failed: ${error.message}`);
  }
  return (data ?? []).length;
}

/** The ids one user can actually read out of a table, in seed order. */
async function idsVisibleTo(
  user: SeedUser,
  table: string,
  ids: string[]
): Promise<string[]> {
  const { data, error } = await user.client
    .from(table)
    .select('id')
    .in('id', ids);
  if (error) {
    // A policy denial on SELECT returns [] rather than an error, so anything
    // here is a real failure worth surfacing.
    throw new Error(`select ${table} failed: ${error.message}`);
  }
  return (data ?? []).map(row => (row as { id: string }).id);
}

let p1: SeedUser;
let n1: SeedUser;
let n2: SeedUser;
let h1: SeedUser;
let householdId = '';
let childId = '';

let n1ShiftId = '';
let n2ShiftId = '';
let unassignedShiftId = '';

let n1ShiftChildId = '';
let n2ShiftChildId = '';

let n1ChangeRequestId = '';
let n2ChangeRequestId = '';

/** On N1's shift, written by a parent — she reads it via the CARER arm. */
let n1ShiftEventId = '';
/** On N2's shift, written by N1 — she reads it via the ACTOR arm. */
let n1ActorEventId = '';
/** On N2's shift, written by a parent — N1 must never see this one. */
let n2ShiftEventId = '';
/** shift_id NULL — day-level, parents only. */
let dayLevelEventId = '';

beforeAll(async () => {
  p1 = await createUser('rls-shift-p1');
  n1 = await createUser('rls-shift-n1');
  n2 = await createUser('rls-shift-n2');
  h1 = await createUser('rls-shift-h1');

  householdId = await insertOne('households', {
    name: `Shift RLS ${suffix}`,
    created_by: p1.id,
  });

  await insertOne('household_members', {
    household_id: householdId,
    user_id: p1.id,
    role: 'parent',
    can_edit: true,
  });
  for (const carer of [n1, n2]) {
    await insertOne('household_members', {
      household_id: householdId,
      user_id: carer.id,
      role: 'nanny',
    });
  }
  await insertOne('household_members', {
    household_id: householdId,
    user_id: h1.id,
    role: 'helper',
  });

  childId = await insertOne('children', {
    household_id: householdId,
    name: 'Nia',
  });

  // Distinct windows: 104's exclusion constraint is per (household, carer),
  // so two carers may share an instant, but one carer may not overlap herself.
  n1ShiftId = await insertOne('shifts', {
    household_id: householdId,
    carer_id: n1.id,
    starts_at: '2026-03-02T09:00:00Z',
    ends_at: '2026-03-02T17:00:00Z',
    timezone: 'Europe/London',
    local_date: '2026-03-02',
    status: 'confirmed',
  });
  n2ShiftId = await insertOne('shifts', {
    household_id: householdId,
    carer_id: n2.id,
    starts_at: '2026-03-03T09:00:00Z',
    ends_at: '2026-03-03T17:00:00Z',
    timezone: 'Europe/London',
    local_date: '2026-03-03',
    status: 'confirmed',
  });
  // "Thu — nobody yet": a real displayable state, and PARENTS ONLY under 103.
  unassignedShiftId = await insertOne('shifts', {
    household_id: householdId,
    carer_id: null,
    starts_at: '2026-03-04T09:00:00Z',
    ends_at: '2026-03-04T17:00:00Z',
    timezone: 'Europe/London',
    local_date: '2026-03-04',
    status: 'pending',
  });

  n1ShiftChildId = await insertOne('shift_children', {
    shift_id: n1ShiftId,
    child_id: childId,
  });
  n2ShiftChildId = await insertOne('shift_children', {
    shift_id: n2ShiftId,
    child_id: childId,
  });

  n1ChangeRequestId = await insertOne('shift_change_requests', {
    shift_id: n1ShiftId,
    requested_by: p1.id,
    kind: 'time_change',
    proposed_starts_at: '2026-03-02T10:00:00Z',
    proposed_ends_at: '2026-03-02T17:00:00Z',
    message: 'Can you start an hour later?',
  });
  n2ChangeRequestId = await insertOne('shift_change_requests', {
    shift_id: n2ShiftId,
    requested_by: p1.id,
    kind: 'time_change',
    proposed_starts_at: '2026-03-03T10:00:00Z',
    proposed_ends_at: '2026-03-03T17:00:00Z',
    message: 'Same again on Tuesday?',
  });

  n1ShiftEventId = await insertOne('shift_events', {
    household_id: householdId,
    shift_id: n1ShiftId,
    local_date: '2026-03-02',
    actor_id: p1.id,
    event_type: 'shift_updated',
    payload: {},
  });
  n1ActorEventId = await insertOne('shift_events', {
    household_id: householdId,
    shift_id: n2ShiftId,
    local_date: '2026-03-03',
    actor_id: n1.id,
    event_type: 'running_late',
    payload: {},
  });
  n2ShiftEventId = await insertOne('shift_events', {
    household_id: householdId,
    shift_id: n2ShiftId,
    local_date: '2026-03-03',
    actor_id: p1.id,
    event_type: 'shift_updated',
    payload: {},
  });
  dayLevelEventId = await insertOne('shift_events', {
    household_id: householdId,
    shift_id: null,
    local_date: '2026-03-02',
    actor_id: null,
    event_type: 'uncovered_care',
    payload: { key: 'child-1|2026-03-02' },
  });
});

afterAll(async () => {
  await service.from('households').delete().eq('id', householdId);
  await deleteUsers([p1?.id, n1?.id, n2?.id, h1?.id]);
});

describe('103 — the seed is real (vacuity guards)', () => {
  test('every row this file reasons about exists', async () => {
    expect(await serviceSees('shifts', n1ShiftId)).toBe(1);
    expect(await serviceSees('shifts', n2ShiftId)).toBe(1);
    expect(await serviceSees('shifts', unassignedShiftId)).toBe(1);
    expect(await serviceSees('shift_children', n1ShiftChildId)).toBe(1);
    expect(await serviceSees('shift_children', n2ShiftChildId)).toBe(1);
    expect(await serviceSees('shift_change_requests', n1ChangeRequestId)).toBe(
      1
    );
    expect(await serviceSees('shift_change_requests', n2ChangeRequestId)).toBe(
      1
    );
    expect(await serviceSees('shift_events', n1ShiftEventId)).toBe(1);
    expect(await serviceSees('shift_events', n1ActorEventId)).toBe(1);
    expect(await serviceSees('shift_events', n2ShiftEventId)).toBe(1);
    expect(await serviceSees('shift_events', dayLevelEventId)).toBe(1);
  });
});

describe('103 — a parent still reads the whole household', () => {
  test('shifts, children, change requests and the whole day thread', async () => {
    expect(
      (
        await idsVisibleTo(p1, 'shifts', [
          n1ShiftId,
          n2ShiftId,
          unassignedShiftId,
        ])
      ).sort()
    ).toEqual([n1ShiftId, n2ShiftId, unassignedShiftId].sort());

    expect(
      (
        await idsVisibleTo(p1, 'shift_children', [
          n1ShiftChildId,
          n2ShiftChildId,
        ])
      ).sort()
    ).toEqual([n1ShiftChildId, n2ShiftChildId].sort());

    expect(
      (
        await idsVisibleTo(p1, 'shift_change_requests', [
          n1ChangeRequestId,
          n2ChangeRequestId,
        ])
      ).sort()
    ).toEqual([n1ChangeRequestId, n2ChangeRequestId].sort());

    expect(
      (
        await idsVisibleTo(p1, 'shift_events', [
          n1ShiftEventId,
          n1ActorEventId,
          n2ShiftEventId,
          dayLevelEventId,
        ])
      ).sort()
    ).toEqual(
      [n1ShiftEventId, n1ActorEventId, n2ShiftEventId, dayLevelEventId].sort()
    );
  });
});

describe('103 — a nanny reads only her own', () => {
  test('shifts: hers, never the other carer’s and never the unassigned one', async () => {
    expect(
      await idsVisibleTo(n1, 'shifts', [
        n1ShiftId,
        n2ShiftId,
        unassignedShiftId,
      ])
    ).toEqual([n1ShiftId]);
  });

  test('shift_children: only the rows hanging off her own shift', async () => {
    expect(
      await idsVisibleTo(n1, 'shift_children', [n1ShiftChildId, n2ShiftChildId])
    ).toEqual([n1ShiftChildId]);
  });

  test('shift_change_requests: only the ones on her own shift', async () => {
    expect(
      await idsVisibleTo(n1, 'shift_change_requests', [
        n1ChangeRequestId,
        n2ChangeRequestId,
      ])
    ).toEqual([n1ChangeRequestId]);
  });

  test('shift_events: her shift’s rows AND rows she wrote, never the day-level one', async () => {
    const visible = await idsVisibleTo(n1, 'shift_events', [
      n1ShiftEventId,
      n1ActorEventId,
      n2ShiftEventId,
      dayLevelEventId,
    ]);
    // n1ShiftEventId via the carer arm; n1ActorEventId via the actor arm —
    // she wrote it, even though it hangs off another carer's shift.
    expect(visible.sort()).toEqual([n1ShiftEventId, n1ActorEventId].sort());
    expect(visible).not.toContain(n2ShiftEventId);
    // Day-level rows (`uncovered_care`, `timesheet_reopened`) are household
    // facts with no shift to attach them to a carer by. Parents only.
    expect(visible).not.toContain(dayLevelEventId);
  });

  test('the second nanny sees the mirror image, and none of the first’s', async () => {
    expect(
      await idsVisibleTo(n2, 'shifts', [
        n1ShiftId,
        n2ShiftId,
        unassignedShiftId,
      ])
    ).toEqual([n2ShiftId]);
    expect(
      await idsVisibleTo(n2, 'shift_children', [n1ShiftChildId, n2ShiftChildId])
    ).toEqual([n2ShiftChildId]);
    expect(
      await idsVisibleTo(n2, 'shift_change_requests', [
        n1ChangeRequestId,
        n2ChangeRequestId,
      ])
    ).toEqual([n2ChangeRequestId]);
    // Both rows on HER shift, whoever wrote them — including N1's running_late.
    expect(
      (
        await idsVisibleTo(n2, 'shift_events', [
          n1ShiftEventId,
          n1ActorEventId,
          n2ShiftEventId,
          dayLevelEventId,
        ])
      ).sort()
    ).toEqual([n1ActorEventId, n2ShiftEventId].sort());
  });
});

describe('103 — a helper reads nothing', () => {
  test('all four tables come back empty', async () => {
    expect(
      await idsVisibleTo(h1, 'shifts', [
        n1ShiftId,
        n2ShiftId,
        unassignedShiftId,
      ])
    ).toEqual([]);
    expect(
      await idsVisibleTo(h1, 'shift_children', [n1ShiftChildId, n2ShiftChildId])
    ).toEqual([]);
    expect(
      await idsVisibleTo(h1, 'shift_change_requests', [
        n1ChangeRequestId,
        n2ChangeRequestId,
      ])
    ).toEqual([]);
    expect(
      await idsVisibleTo(h1, 'shift_events', [
        n1ShiftEventId,
        n1ActorEventId,
        n2ShiftEventId,
        dayLevelEventId,
      ])
    ).toEqual([]);
  });

  test('the helper IS an active member — the emptiness is the policy, not the seed', async () => {
    const { data, error } = await h1.client
      .from('household_members')
      .select('id, role')
      .eq('household_id', householdId)
      .eq('user_id', h1.id);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect((data?.[0] as { role: string } | undefined)?.role).toBe('helper');
  });
});

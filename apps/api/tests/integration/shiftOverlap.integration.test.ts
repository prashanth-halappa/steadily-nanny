/**
 * Migration 104's `shifts_carer_window_excl` — against a REAL Postgres.
 *
 * The whole point of S4a is that the existing guards test window EQUALITY
 * (059, 062) and therefore let 09:00–17:00 and 10:00–12:00 both insert. No
 * text assertion can prove an exclusion constraint actually excludes; this
 * runs the inserts.
 *
 * It also pins the ORDER the two kinds of guard fire in: an EXACT duplicate
 * must still raise 059/062's 23505, not this constraint's 23P01, because
 * every adopt-the-winner path in the app branches on that code. Index checks
 * run in OID order and those indexes are older, but "older" is a property of
 * the migration history, not of the SQL text — so it is asserted here.
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

/** Postgres `exclusion_violation` — 104's constraint. */
const EXCLUSION_VIOLATION = '23P01';
/** Postgres `unique_violation` — 059/062's window indexes. */
const UNIQUE_VIOLATION = '23505';

interface InsertOutcome {
  id: string | null;
  code: string | null;
  message: string;
}

/** Insert through the service client (RLS bypassed) and report what Postgres said. */
async function tryInsertShift(
  row: Record<string, unknown>
): Promise<InsertOutcome> {
  const { data, error } = await service
    .from('shifts')
    .insert(row)
    .select('id')
    .maybeSingle();
  return {
    id: (data as { id: string } | null)?.id ?? null,
    code: error?.code ?? null,
    message: error?.message ?? '',
  };
}

function shiftRow(
  overrides: Record<string, unknown> & {
    household_id: string;
    starts_at: string;
    ends_at: string;
    local_date: string;
  }
): Record<string, unknown> {
  return {
    timezone: 'Europe/London',
    kind: 'recurring',
    status: 'confirmed',
    ...overrides,
  };
}

let p1: SeedUser;
let n1: SeedUser;
let householdA = '';
let householdB = '';
const created: string[] = [];

beforeAll(async () => {
  p1 = await createUser('excl-p1');
  n1 = await createUser('excl-n1');

  householdA = await insertOne('households', {
    name: `Excl A ${suffix}`,
    created_by: p1.id,
  });
  householdB = await insertOne('households', {
    name: `Excl B ${suffix}`,
    created_by: p1.id,
  });
  for (const household of [householdA, householdB]) {
    await insertOne('household_members', {
      household_id: household,
      user_id: p1.id,
      role: 'parent',
      can_edit: true,
    });
    await insertOne('household_members', {
      household_id: household,
      user_id: n1.id,
      role: 'nanny',
    });
  }
});

afterAll(async () => {
  if (created.length > 0) {
    await service.from('shifts').delete().in('id', created);
  }
  await service.from('households').delete().in('id', [householdA, householdB]);
  await deleteUsers([p1?.id, n1?.id]);
});

describe('104 — same carer, same household, overlapping windows', () => {
  test('a 10:00–12:00 inside an existing 09:00–17:00 is REFUSED', async () => {
    const anchor = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        starts_at: '2026-04-06T09:00:00Z',
        ends_at: '2026-04-06T17:00:00Z',
        local_date: '2026-04-06',
      })
    );
    // Vacuity guard: the row this test collides against really landed.
    expect(anchor.code).toBeNull();
    expect(anchor.id).not.toBeNull();
    if (anchor.id) {
      created.push(anchor.id);
    }

    const inner = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        kind: 'extra',
        starts_at: '2026-04-06T10:00:00Z',
        ends_at: '2026-04-06T12:00:00Z',
        local_date: '2026-04-06',
      })
    );

    expect(inner.id).toBeNull();
    expect(inner.code).toBe(EXCLUSION_VIOLATION);
    expect(inner.message).toContain('shifts_carer_window_excl');
  });

  test('a 12:00–15:00 straight after a 09:00–12:00 is ALLOWED — the range is half-open', async () => {
    const morning = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        starts_at: '2026-04-07T09:00:00Z',
        ends_at: '2026-04-07T12:00:00Z',
        local_date: '2026-04-07',
      })
    );
    expect(morning.code).toBeNull();
    if (morning.id) {
      created.push(morning.id);
    }

    const afternoon = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        kind: 'extra',
        starts_at: '2026-04-07T12:00:00Z',
        ends_at: '2026-04-07T15:00:00Z',
        local_date: '2026-04-07',
      })
    );

    // `[)`: a split day is normal, not a double-booking.
    expect(afternoon.code).toBeNull();
    expect(afternoon.id).not.toBeNull();
    if (afternoon.id) {
      created.push(afternoon.id);
    }
  });

  test('overlapping a CANCELLED shift is allowed — a called-off booking occupies nobody', async () => {
    const cancelled = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        status: 'cancelled',
        starts_at: '2026-04-08T09:00:00Z',
        ends_at: '2026-04-08T17:00:00Z',
        local_date: '2026-04-08',
      })
    );
    expect(cancelled.code).toBeNull();
    if (cancelled.id) {
      created.push(cancelled.id);
    }

    const replacement = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        kind: 'cover',
        starts_at: '2026-04-08T10:00:00Z',
        ends_at: '2026-04-08T12:00:00Z',
        local_date: '2026-04-08',
      })
    );

    expect(replacement.code).toBeNull();
    expect(replacement.id).not.toBeNull();
    if (replacement.id) {
      created.push(replacement.id);
    }
  });

  test('overlapping a DECLINED shift is allowed — she said no', async () => {
    const declined = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        status: 'declined',
        kind: 'extra',
        starts_at: '2026-04-09T09:00:00Z',
        ends_at: '2026-04-09T17:00:00Z',
        local_date: '2026-04-09',
      })
    );
    expect(declined.code).toBeNull();
    if (declined.id) {
      created.push(declined.id);
    }

    const replacement = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        starts_at: '2026-04-09T10:00:00Z',
        ends_at: '2026-04-09T12:00:00Z',
        local_date: '2026-04-09',
      })
    );
    expect(replacement.code).toBeNull();
    if (replacement.id) {
      created.push(replacement.id);
    }
  });

  test('an unassigned (carer_id null) overlap is allowed — "Thu, nobody yet" is a real state', async () => {
    const first = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: null,
        status: 'pending',
        starts_at: '2026-04-10T09:00:00Z',
        ends_at: '2026-04-10T17:00:00Z',
        local_date: '2026-04-10',
      })
    );
    expect(first.code).toBeNull();
    if (first.id) {
      created.push(first.id);
    }

    const second = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: null,
        kind: 'extra',
        status: 'pending',
        starts_at: '2026-04-10T10:00:00Z',
        ends_at: '2026-04-10T12:00:00Z',
        local_date: '2026-04-10',
      })
    );
    expect(second.code).toBeNull();
    if (second.id) {
      created.push(second.id);
    }
  });
});

describe('104 — the boundaries the constraint must NOT cross', () => {
  test('the SAME carer overlapping in ANOTHER household is allowed — cross-household stays advisory', async () => {
    const inA = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        starts_at: '2026-04-13T09:00:00Z',
        ends_at: '2026-04-13T17:00:00Z',
        local_date: '2026-04-13',
      })
    );
    expect(inA.code).toBeNull();
    if (inA.id) {
      created.push(inA.id);
    }

    const inB = await tryInsertShift(
      shiftRow({
        household_id: householdB,
        carer_id: n1.id,
        starts_at: '2026-04-13T10:00:00Z',
        ends_at: '2026-04-13T12:00:00Z',
        local_date: '2026-04-13',
      })
    );

    // 015's product rule, unchanged: a nanny may double-book across families,
    // and `clashWarning` warns rather than blocks.
    expect(inB.code).toBeNull();
    expect(inB.id).not.toBeNull();
    if (inB.id) {
      created.push(inB.id);
    }
  });

  test('an EXACT duplicate recurring window still raises 062’s 23505, not 23P01', async () => {
    const first = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        starts_at: '2026-04-14T09:00:00Z',
        ends_at: '2026-04-14T17:00:00Z',
        local_date: '2026-04-14',
      })
    );
    expect(first.code).toBeNull();
    if (first.id) {
      created.push(first.id);
    }

    const duplicate = await tryInsertShift(
      shiftRow({
        household_id: householdA,
        carer_id: n1.id,
        starts_at: '2026-04-14T09:00:00Z',
        ends_at: '2026-04-14T17:00:00Z',
        local_date: '2026-04-14',
      })
    );

    // Load-bearing: `scheduleMaterialisationService` adopts the winner on
    // 23505 and only records a conflict on 23P01. If OID order ever put the
    // exclusion constraint first, every adopt path would start warning
    // instead of adopting, and this is the assertion that would catch it.
    expect(duplicate.id).toBeNull();
    expect(duplicate.code).toBe(UNIQUE_VIOLATION);
    expect(duplicate.message).toContain('shifts_recurring_window_unique');
  });
});

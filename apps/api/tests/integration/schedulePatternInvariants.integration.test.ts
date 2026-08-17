/**
 * Migration 104's two remaining guards, against a REAL Postgres:
 *
 *   - `schedule_patterns_one_accepted_idx` — the root invariant the whole
 *     confirmation model rests on and that only application code has ever
 *     enforced (audit S3). 062's header records what its absence cost:
 *     "THREE identical live recurring shifts from three different patterns
 *     for one carer."
 *   - `shifts_cover_window_unique` / `shifts_parent_cover_window_unique` —
 *     the two `kind`s 059 and 062 left without a dedupe index, which is what
 *     lets a double-tapped "I've got it" write two identical covers.
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

const UNIQUE_VIOLATION = '23505';

interface InsertOutcome {
  id: string | null;
  code: string | null;
  message: string;
}

async function tryInsert(
  table: string,
  row: Record<string, unknown>
): Promise<InsertOutcome> {
  const { data, error } = await service
    .from(table)
    .insert(row)
    .select('id')
    .maybeSingle();
  return {
    id: (data as { id: string } | null)?.id ?? null,
    code: error?.code ?? null,
    message: error?.message ?? '',
  };
}

function patternRow(
  overrides: Record<string, unknown>
): Record<string, unknown> {
  return {
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU',
    dtstart: '2026-05-04',
    timezone: 'Europe/London',
    ...overrides,
  };
}

let p1: SeedUser;
let n1: SeedUser;
let n2: SeedUser;
let householdId = '';
const patterns: string[] = [];
const shifts: string[] = [];

beforeAll(async () => {
  p1 = await createUser('inv-p1');
  n1 = await createUser('inv-n1');
  n2 = await createUser('inv-n2');

  householdId = await insertOne('households', {
    name: `Invariants ${suffix}`,
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
});

afterAll(async () => {
  if (shifts.length > 0) {
    await service.from('shifts').delete().in('id', shifts);
  }
  if (patterns.length > 0) {
    await service.from('schedule_patterns').delete().in('id', patterns);
  }
  await service.from('households').delete().eq('id', householdId);
  await deleteUsers([p1?.id, n1?.id, n2?.id]);
});

describe('104 — one accepted pattern per (household, carer)', () => {
  test('a SECOND accepted pattern for the same carer is refused', async () => {
    const first = await tryInsert(
      'schedule_patterns',
      patternRow({
        household_id: householdId,
        carer_id: n1.id,
        status: 'accepted',
      })
    );
    // Vacuity guard: the row the duplicate collides against really landed.
    expect(first.code).toBeNull();
    expect(first.id).not.toBeNull();
    if (first.id) {
      patterns.push(first.id);
    }

    const second = await tryInsert(
      'schedule_patterns',
      patternRow({
        household_id: householdId,
        carer_id: n1.id,
        status: 'accepted',
        // A genuinely different week — the index is on the PAIR, not the rule.
        rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE,TH',
      })
    );

    expect(second.id).toBeNull();
    expect(second.code).toBe(UNIQUE_VIOLATION);
    expect(second.message).toContain('schedule_patterns_one_accepted_idx');
  });

  test('a second accepted pattern for a DIFFERENT carer is fine — multi-nanny households are real', async () => {
    const other = await tryInsert(
      'schedule_patterns',
      patternRow({
        household_id: householdId,
        carer_id: n2.id,
        status: 'accepted',
      })
    );
    expect(other.code).toBeNull();
    expect(other.id).not.toBeNull();
    if (other.id) {
      patterns.push(other.id);
    }
  });

  test('non-accepted statuses stack freely — a pending proposal is not a live week', async () => {
    for (const status of ['pending', 'declined', 'ended'] as const) {
      const row = await tryInsert(
        'schedule_patterns',
        patternRow({ household_id: householdId, carer_id: n1.id, status })
      );
      expect(row.code).toBeNull();
      if (row.id) {
        patterns.push(row.id);
      }
    }
    // Two of the same non-accepted status, to prove it is not a per-status key.
    const second = await tryInsert(
      'schedule_patterns',
      patternRow({
        household_id: householdId,
        carer_id: n1.id,
        status: 'pending',
      })
    );
    expect(second.code).toBeNull();
    if (second.id) {
      patterns.push(second.id);
    }
  });

  test('CARER-LESS accepted patterns stack — a parent sketching a week before any nanny exists', async () => {
    for (let i = 0; i < 2; i += 1) {
      const row = await tryInsert(
        'schedule_patterns',
        patternRow({
          household_id: householdId,
          carer_id: null,
          status: 'accepted',
        })
      );
      expect(row.code).toBeNull();
      if (row.id) {
        patterns.push(row.id);
      }
    }
  });
});

describe('104 — cover and parent_cover window dedupe', () => {
  test('a duplicate COVER window for the same carer is refused', async () => {
    const first = await tryInsert('shifts', {
      household_id: householdId,
      carer_id: n1.id,
      kind: 'cover',
      status: 'pending',
      starts_at: '2026-05-11T09:00:00Z',
      ends_at: '2026-05-11T13:00:00Z',
      timezone: 'Europe/London',
      local_date: '2026-05-11',
    });
    expect(first.code).toBeNull();
    expect(first.id).not.toBeNull();
    if (first.id) {
      shifts.push(first.id);
    }

    const duplicate = await tryInsert('shifts', {
      household_id: householdId,
      carer_id: n1.id,
      kind: 'cover',
      status: 'pending',
      starts_at: '2026-05-11T09:00:00Z',
      ends_at: '2026-05-11T13:00:00Z',
      timezone: 'Europe/London',
      local_date: '2026-05-11',
    });

    expect(duplicate.id).toBeNull();
    expect(duplicate.code).toBe(UNIQUE_VIOLATION);
    expect(duplicate.message).toContain('shifts_cover_window_unique');
  });

  test('a duplicate PARENT_COVER window is refused even though carer_id is NULL', async () => {
    const first = await tryInsert('shifts', {
      household_id: householdId,
      carer_id: null,
      kind: 'parent_cover',
      status: 'confirmed',
      starts_at: '2026-05-12T09:00:00Z',
      ends_at: '2026-05-12T13:00:00Z',
      timezone: 'Europe/London',
      local_date: '2026-05-12',
    });
    expect(first.code).toBeNull();
    expect(first.id).not.toBeNull();
    if (first.id) {
      shifts.push(first.id);
    }

    const duplicate = await tryInsert('shifts', {
      household_id: householdId,
      carer_id: null,
      kind: 'parent_cover',
      status: 'confirmed',
      starts_at: '2026-05-12T09:00:00Z',
      ends_at: '2026-05-12T13:00:00Z',
      timezone: 'Europe/London',
      local_date: '2026-05-12',
    });

    // THE NULL TRAP: without `nulls not distinct` Postgres treats the two
    // NULL carer_ids as distinct and this second row lands.
    expect(duplicate.id).toBeNull();
    expect(duplicate.code).toBe(UNIQUE_VIOLATION);
    expect(duplicate.message).toContain('shifts_parent_cover_window_unique');
  });

  test('a replacement for a CANCELLED cover is a new shift, not a duplicate', async () => {
    const cancelled = await tryInsert('shifts', {
      household_id: householdId,
      carer_id: n2.id,
      kind: 'cover',
      status: 'cancelled',
      starts_at: '2026-05-13T09:00:00Z',
      ends_at: '2026-05-13T13:00:00Z',
      timezone: 'Europe/London',
      local_date: '2026-05-13',
    });
    expect(cancelled.code).toBeNull();
    if (cancelled.id) {
      shifts.push(cancelled.id);
    }

    const replacement = await tryInsert('shifts', {
      household_id: householdId,
      carer_id: n2.id,
      kind: 'cover',
      status: 'pending',
      starts_at: '2026-05-13T09:00:00Z',
      ends_at: '2026-05-13T13:00:00Z',
      timezone: 'Europe/London',
      local_date: '2026-05-13',
    });

    expect(replacement.code).toBeNull();
    expect(replacement.id).not.toBeNull();
    if (replacement.id) {
      shifts.push(replacement.id);
    }
  });
});

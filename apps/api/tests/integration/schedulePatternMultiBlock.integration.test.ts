/**
 * @module tests/integration/schedulePatternMultiBlock.integration.test
 *
 * Proves migration 101 BEHAVIOURALLY against a REAL Postgres: a weekday may
 * hold two time blocks (Mon 08:00-12:00 AND 14:00-18:00) — the unique index
 * on `(pattern_id, weekday, start_time)` accepts both and still refuses a
 * third block that repeats an existing `start_time` (the modelling-error case
 * 101's header calls out, distinct from an overlap, which the index does NOT
 * block — 015's "NO OVERLAP CONSTRAINT, DELIBERATELY"). It then drives the
 * real materialisation code path — `schedulePatternCommandService
 * .materialiseForHorizon` — and asserts TWO shifts land on the Monday, one
 * per block. This is exactly the shape GOLDEN-FIXES #46 says broke
 * materialisation three separate ways while every unit-test fixture (all
 * new-world, single-block-per-day) stayed green.
 *
 * `materialiseForHorizon` needs the REAL Supabase service client, which
 * `apps/api/src/config/env.ts` only builds from `process.env` when
 * `NODE_ENV !== 'test'` — the test-mode branch returns hardcoded fake
 * placeholders regardless of what's exported, by design, so unit tests never
 * need a database. The global preload (`tests/setup/globalSetup.ts`) sets
 * `NODE_ENV=test` in ITS OWN `beforeAll`, which Bun runs before this file's
 * (registration order), so this file's `beforeAll` flips it back to
 * `development` as its first line, before the dynamic import that first
 * evaluates `config/env.ts` — env.ts then validates the real
 * SUPABASE_URL/ANON_KEY/SERVICE_KEY this file already required, and the
 * command service talks to the same local stack every other helper here
 * uses. This is scoped to this one process (docs/09-TESTING.md §2 — one bun
 * process per file via `scripts/run-tests-one-file.sh`), so no sibling
 * integration file is affected either way.
 *
 * NOT part of `bun run test` / `bun run qc`. Run it explicitly:
 *
 *   supabase start && eval "$(supabase status -o env |
 *     sed 's/^API_URL=/SUPABASE_URL=/;s/^ANON_KEY=/SUPABASE_ANON_KEY=/;s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_KEY=/' |
 *     sed 's/^/export /')"
 *   bun test tests/integration/schedulePatternMultiBlock.integration.test.ts
 *
 * CI runs it in the `db-migrations-and-rls` job alongside the other two files
 * (`bun run test:db`). Client/user/guard plumbing lives in
 * `./helpers/localStack`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { SchedulePattern } from '../../src/domains/schedule/types';
import {
  deleteUsers,
  insertOne,
  serviceClient,
  withHousehold,
} from './helpers/localStack';

const service = serviceClient();

// 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow) — 014's header.
const MONDAY = 1;
const DTSTART = '2026-08-17'; // a Monday.
// Fixed rather than `new Date()`, so the materialisation horizon and the
// "today" cutoff used for orphaning/uncovered-care detection are deterministic
// regardless of when this file actually runs.
const NOW = new Date(`${DTSTART}T00:00:00Z`);

let parentId = '';
let carerId = '';
let householdId = '';
let patternId = '';
// biome-ignore lint/suspicious/noExplicitAny: dynamically imported after the
// NODE_ENV flip below; typing the whole module import is more ceremony than
// the one call site (materialiseForHorizon) needs.
let schedulePatternCommandService: any;

beforeAll(async () => {
  // See module doc: must happen before the FIRST import of config/env.ts.
  process.env.NODE_ENV = 'development';
  ({ schedulePatternCommandService } = await import(
    '../../src/domains/schedule/services/schedulePatternCommandService'
  ));

  const household = await withHousehold({
    parentLabel: 'block-parent',
    nannyLabels: ['block-carer'],
  });
  householdId = household.householdId;
  parentId = household.parent?.id ?? '';
  carerId = household.nannies[0]?.id ?? '';

  patternId = await insertOne('schedule_patterns', {
    household_id: householdId,
    carer_id: carerId,
    status: 'accepted',
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    dtstart: DTSTART,
    timezone: 'Europe/London',
    created_by: parentId,
  });

  const { error: daysErr } = await service
    .from('schedule_pattern_days')
    .insert([
      {
        pattern_id: patternId,
        weekday: MONDAY,
        start_time: '08:00',
        end_time: '12:00',
      },
      {
        pattern_id: patternId,
        weekday: MONDAY,
        start_time: '14:00',
        end_time: '18:00',
      },
    ]);
  if (daysErr) {
    throw new Error(`seed schedule_pattern_days failed: ${daysErr.message}`);
  }
});

afterAll(async () => {
  if (householdId) {
    await service.from('households').delete().eq('id', householdId);
  }
  await deleteUsers([parentId, carerId]);
  process.env.NODE_ENV = 'test';
});

describe('101 — a weekday holds two blocks (live Postgres)', () => {
  it('accepts two blocks on the same Monday', async () => {
    const { data, error } = await service
      .from('schedule_pattern_days')
      .select('id, start_time, end_time')
      .eq('pattern_id', patternId)
      .eq('weekday', MONDAY);
    if (error) {
      throw new Error(`read schedule_pattern_days failed: ${error.message}`);
    }
    expect(data ?? []).toHaveLength(2);
  });

  it('refuses a third block repeating an existing start_time', async () => {
    const { error } = await service.from('schedule_pattern_days').insert({
      pattern_id: patternId,
      weekday: MONDAY,
      start_time: '08:00',
      end_time: '09:00',
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toContain('duplicate key');
  });

  it('materialises two shifts on the Monday — one per block (GOLDEN-FIXES #46)', async () => {
    const { data: patternRow, error: patternErr } = await service
      .from('schedule_patterns')
      .select('*')
      .eq('id', patternId)
      .single();
    if (patternErr || !patternRow) {
      throw new Error(`read pattern failed: ${patternErr?.message}`);
    }

    const result = await schedulePatternCommandService.materialiseForHorizon(
      patternRow as SchedulePattern,
      84,
      NOW
    );
    expect(result.created).toBeGreaterThanOrEqual(2);

    const { data: shifts, error: shiftsErr } = await service
      .from('shifts')
      .select('id, starts_at, status')
      .eq('source_pattern_id', patternId)
      .eq('local_date', DTSTART)
      .order('starts_at', { ascending: true });
    if (shiftsErr) {
      throw new Error(`read shifts failed: ${shiftsErr.message}`);
    }
    expect(shifts ?? []).toHaveLength(2);
    expect(shifts?.[0]?.starts_at).not.toBe(shifts?.[1]?.starts_at);
  });
});

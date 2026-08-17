/**
 * @module tests/integration/timesheetParentViewed.integration.test
 *
 * Proves migration 100's timesheets-own `updated_at` trigger against a REAL
 * Postgres: a `parent_viewed_at`-only write must not bump `updated_at`
 * (otherwise `approveSubmittedWithEarnings`'s compare-and-swap loses), a
 * `total_minutes` write still bumps, and a second stamp guarded by
 * `.is('parent_viewed_at', null)` matches no rows.
 *
 * NOT part of `bun run test` / `bun run qc` — those sweep `tests/unit` only.
 * Run it explicitly:
 *
 *   supabase start && eval "$(supabase status -o env |
 *     sed 's/^API_URL=/SUPABASE_URL=/;s/^ANON_KEY=/SUPABASE_ANON_KEY=/;s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_KEY=/' |
 *     sed 's/^/export /')"
 *   bun test tests/integration/timesheetParentViewed.integration.test.ts
 *
 * CI runs it in the `db-migrations-and-rls` job after the RLS file.
 * Client/user/guard plumbing lives in `./helpers/localStack`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  deleteUsers,
  insertOne,
  serviceClient,
  withHousehold,
} from './helpers/localStack';

const service = serviceClient();

const VIEWED_AT = '2026-08-16T12:00:00.000Z';

let parentId = '';
let carerId = '';
let householdId = '';
let timesheetId = '';

async function readTimesheet(): Promise<{
  updated_at: string;
  parent_viewed_at: string | null;
  total_minutes: number;
  status: string;
}> {
  const { data, error } = await service
    .from('timesheets')
    .select('updated_at, parent_viewed_at, total_minutes, status')
    .eq('id', timesheetId)
    .single();
  if (error || !data) {
    throw new Error(`read timesheet failed: ${error?.message}`);
  }
  return data as {
    updated_at: string;
    parent_viewed_at: string | null;
    total_minutes: number;
    status: string;
  };
}

beforeAll(async () => {
  const household = await withHousehold({
    parentLabel: 'viewed-parent',
    nannyLabels: ['viewed-carer'],
  });
  householdId = household.householdId;
  parentId = household.parent?.id ?? '';
  carerId = household.nannies[0]?.id ?? '';

  timesheetId = await insertOne('timesheets', {
    household_id: householdId,
    carer_id: carerId,
    carer_display_name: 'Viewed Carer',
    week_start: '2026-08-03',
    total_minutes: 480,
    status: 'submitted',
  });
});

afterAll(async () => {
  if (householdId) {
    await service.from('households').delete().eq('id', householdId);
  }
  await deleteUsers([parentId, carerId]);
});

describe('100 — timesheets parent_viewed_at trigger (live Postgres)', () => {
  it('an update of only parent_viewed_at leaves updated_at unchanged', async () => {
    const before = await readTimesheet();

    const { error } = await service
      .from('timesheets')
      .update({ parent_viewed_at: VIEWED_AT })
      .eq('id', timesheetId);
    if (error) {
      throw new Error(`viewed stamp failed: ${error.message}`);
    }

    const after = await readTimesheet();
    expect(after.parent_viewed_at).not.toBeNull();
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('an update of total_minutes still bumps updated_at and keeps parent_viewed_at', async () => {
    const before = await readTimesheet();
    expect(before.parent_viewed_at).not.toBeNull();

    const { error } = await service
      .from('timesheets')
      .update({ total_minutes: 540 })
      .eq('id', timesheetId);
    if (error) {
      throw new Error(`minutes bump failed: ${error.message}`);
    }

    const after = await readTimesheet();
    expect(after.total_minutes).toBe(540);
    expect(after.parent_viewed_at).not.toBeNull();
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it('the approve compare-and-swap still matches after a viewed stamp', async () => {
    const { data: reset, error: resetErr } = await service
      .from('timesheets')
      .update({
        parent_viewed_at: null,
        status: 'submitted',
        total_minutes: 480,
      })
      .eq('id', timesheetId)
      .select('updated_at')
      .single();
    if (resetErr || !reset) {
      throw new Error(`reset failed: ${resetErr?.message}`);
    }
    const version = reset.updated_at as string;

    const { error: stampErr } = await service
      .from('timesheets')
      .update({ parent_viewed_at: VIEWED_AT })
      .eq('id', timesheetId);
    if (stampErr) {
      throw new Error(`CAS viewed stamp failed: ${stampErr.message}`);
    }

    const { data, error } = await service
      .from('timesheets')
      .update({ status: 'approved' })
      .eq('id', timesheetId)
      .eq('status', 'submitted')
      .eq('updated_at', version)
      .select('id')
      .maybeSingle();
    if (error) {
      throw new Error(`CAS approve failed: ${error.message}`);
    }
    expect(data).not.toBeNull();
    expect(data?.id).toBe(timesheetId);
  });

  it('a second stamp guarded by .is(parent_viewed_at, null) matches no rows', async () => {
    const { data: reset, error: resetErr } = await service
      .from('timesheets')
      .update({ parent_viewed_at: null, status: 'submitted' })
      .eq('id', timesheetId)
      .select('id')
      .single();
    if (resetErr || !reset) {
      throw new Error(`second-stamp reset failed: ${resetErr?.message}`);
    }

    const { error: firstErr } = await service
      .from('timesheets')
      .update({ parent_viewed_at: VIEWED_AT })
      .eq('id', timesheetId)
      .is('parent_viewed_at', null);
    if (firstErr) {
      throw new Error(`first stamp failed: ${firstErr.message}`);
    }

    const { data, error } = await service
      .from('timesheets')
      .update({ parent_viewed_at: '2026-08-16T18:00:00.000Z' })
      .eq('id', timesheetId)
      .is('parent_viewed_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      throw new Error(`second stamp failed: ${error.message}`);
    }
    expect(data).toBeNull();

    const row = await readTimesheet();
    expect(row.parent_viewed_at).not.toBeNull();
  });
});

/**
 * @module tests/integration/reopenWithPayments.integration.test
 *
 * Migration 102's two answers to gap P1 (`docs/AS-BUILT-PAYMENT.md` §7),
 * against a REAL Postgres — the only place either can be proved.
 *
 * The hole: every payment against a week is bounded by that week's frozen
 * `gross_minor` (077 sums and refuses under a row lock), and BOTH ways out of
 * `approved` used to clear that gross without ever asking whether money had
 * moved. `payments` is append-only, so the balance simply goes negative and
 * stays there.
 *
 * The two answers differ because the two acts differ:
 *
 *  - A MANUAL REOPEN is a decision someone is making right now, in front of a
 *    screen that already shows what has been paid → refused, by
 *    `timesheets_refuse_reopen_when_paid`, with SQLSTATE P0001.
 *  - A CLOCK-OUT is not a decision — the hours already happened, and a
 *    clock-out that can fail is the one thing this path must never be → the
 *    minutes are recorded, the approval and all four snapshot columns are
 *    KEPT, and `hours_changed_after_payment_at` is stamped instead.
 *
 * A text assertion cannot reach either: the trigger has to actually fire, and
 * `roll_up_timesheet_hours` has to actually take the lock, read `payments`
 * inside it, and write seven CASE'd columns in one statement.
 *
 * NOT part of `bun run test` / `bun run qc`. Run it explicitly:
 *
 *   supabase start && supabase db reset --local && eval "$(supabase status -o env |
 *     sed 's/^API_URL=/SUPABASE_URL=/;s/^ANON_KEY=/SUPABASE_ANON_KEY=/;s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_KEY=/' |
 *     sed 's/^/export /')"
 *   bun test tests/integration/reopenWithPayments.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  deleteUsers,
  insertOne,
  serviceClient,
  withHousehold,
} from './helpers/localStack';

const service = serviceClient();

const FROZEN_AT = '2026-08-10T18:00:00.000Z';
const GROSS_MINOR = 80_000;

let parentId = '';
let carerId = '';
let householdId = '';
/** Approved, priced, and has a payment row against it. */
let paidId = '';
/** Approved and priced, nothing paid. */
let unpaidId = '';

interface TimesheetShape {
  status: string;
  total_minutes: number;
  approved_by: string | null;
  approved_at: string | null;
  gross_minor: number | null;
  currency: string | null;
  earnings: unknown;
  earnings_computed_at: string | null;
  hours_changed_after_payment_at: string | null;
  updated_at: string;
}

const COLUMNS =
  'status, total_minutes, approved_by, approved_at, gross_minor, currency, earnings, earnings_computed_at, hours_changed_after_payment_at, updated_at';

async function read(id: string): Promise<TimesheetShape> {
  const { data, error } = await service
    .from('timesheets')
    .select(COLUMNS)
    .eq('id', id)
    .single();
  if (error || !data) {
    throw new Error(`read timesheet failed: ${error?.message}`);
  }
  return data as unknown as TimesheetShape;
}

async function seedApprovedWeek(weekStart: string): Promise<string> {
  return insertOne('timesheets', {
    household_id: householdId,
    carer_id: carerId,
    carer_display_name: 'Reopen Carer',
    week_start: weekStart,
    total_minutes: 2400,
    status: 'approved',
    approved_by: parentId,
    approved_at: FROZEN_AT,
    gross_minor: GROSS_MINOR,
    currency: 'GBP',
    earnings: { status: 'ok', gross_minor: GROSS_MINOR },
    earnings_computed_at: FROZEN_AT,
  });
}

beforeAll(async () => {
  const household = await withHousehold({
    parentLabel: 'reopen-parent',
    nannyLabels: ['reopen-carer'],
  });
  householdId = household.householdId;
  parentId = household.parent?.id ?? '';
  carerId = household.nannies[0]?.id ?? '';

  paidId = await seedApprovedWeek('2026-08-10');
  unpaidId = await seedApprovedWeek('2026-08-17');

  await insertOne('payments', {
    timesheet_id: paidId,
    household_id: householdId,
    carer_id: carerId,
    amount_minor: GROSS_MINOR,
    currency: 'GBP',
    paid_at: '2026-08-14',
    recorded_by: parentId,
  });
});

afterAll(async () => {
  if (householdId) {
    await service.from('households').delete().eq('id', householdId);
  }
  await deleteUsers([parentId, carerId]);
});

describe('timesheets_refuse_reopen_when_paid', () => {
  it('refuses a move out of approved on a week that has payments', async () => {
    const before = await read(paidId);

    const { error } = await service
      .from('timesheets')
      .update({
        status: 'submitted',
        approved_by: null,
        approved_at: null,
        gross_minor: null,
        currency: null,
        earnings: null,
        earnings_computed_at: null,
      })
      .eq('id', paidId);

    // The message is the contract the repository translates into the 409 the
    // sheet branches on — a silent no-op would be indistinguishable from a
    // lost compare-and-swap.
    expect(error?.message).toContain('TIMESHEET_HAS_PAYMENTS');

    // Nothing moved. Not "rolled back after a partial write" — refused BEFORE.
    const after = await read(paidId);
    expect(after.status).toBe('approved');
    expect(after.gross_minor).toBe(GROSS_MINOR);
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('lets a week with NO payments out of approved', async () => {
    const { error } = await service
      .from('timesheets')
      .update({
        status: 'submitted',
        approved_by: null,
        approved_at: null,
        gross_minor: null,
        currency: null,
        earnings: null,
        earnings_computed_at: null,
      })
      .eq('id', unpaidId);

    expect(error).toBeNull();
    expect((await read(unpaidId)).status).toBe('submitted');

    // Put it back for the roll-up cases below.
    const { error: restoreErr } = await service
      .from('timesheets')
      .update({
        status: 'approved',
        approved_by: parentId,
        approved_at: FROZEN_AT,
        gross_minor: GROSS_MINOR,
        currency: 'GBP',
        earnings: { status: 'ok', gross_minor: GROSS_MINOR },
        earnings_computed_at: FROZEN_AT,
      })
      .eq('id', unpaidId);
    expect(restoreErr).toBeNull();
  });

  it('does not stand in the way of an ordinary edit to an approved week', async () => {
    // The predicate is `old.status = 'approved' and new.status <> 'approved'`,
    // not "this row has payments". A write that leaves the status alone —
    // which is exactly what the paid branch of the roll-up does — must pass.
    const { error } = await service
      .from('timesheets')
      .update({ carer_display_name: 'Reopen Carer' })
      .eq('id', paidId);

    expect(error).toBeNull();
  });
});

describe('roll_up_timesheet_hours — a PAID week', () => {
  it('records the minutes, keeps status, approver and the whole snapshot, and raises the flag', async () => {
    const before = await read(paidId);

    const { data, error } = await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: paidId,
      p_total_minutes: 2700,
    });
    expect(error).toBeNull();
    expect((data as TimesheetShape[]).length).toBe(1);

    const after = await read(paidId);
    expect(after.total_minutes).toBe(2700);
    // The payments were bounded by THIS gross. Clearing it is the whole bug.
    expect(after.status).toBe('approved');
    expect(after.approved_by).toBe(parentId);
    expect(after.approved_at).toBe(before.approved_at ?? '');
    expect(after.gross_minor).toBe(GROSS_MINOR);
    expect(after.currency).toBe('GBP');
    expect(after.earnings).toEqual(before.earnings);
    expect(after.earnings_computed_at).toBe(before.earnings_computed_at ?? '');
    // The one thing that changed besides the minutes: the flag both week views
    // render, because the approved total no longer covers every hour worked.
    expect(after.hours_changed_after_payment_at).not.toBeNull();
    // A real row version — approve's compare-and-swap depends on it moving.
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it('never trips the reopen trigger, because it writes the status back as itself', async () => {
    const { error } = await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: paidId,
      p_total_minutes: 2760,
    });

    expect(error).toBeNull();
    expect((await read(paidId)).total_minutes).toBe(2760);
  });
});

describe('roll_up_timesheet_hours — an UNPAID week', () => {
  it('demotes to submitted and clears the approval and all four snapshot columns (D1)', async () => {
    const before = await read(unpaidId);
    expect(before.status).toBe('approved');

    const { error } = await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: unpaidId,
      p_total_minutes: 3000,
    });
    expect(error).toBeNull();

    const after = await read(unpaidId);
    expect(after.total_minutes).toBe(3000);
    expect(after.status).toBe('submitted');
    expect(after.approved_by).toBeNull();
    expect(after.approved_at).toBeNull();
    expect(after.gross_minor).toBeNull();
    expect(after.currency).toBeNull();
    expect(after.earnings).toBeNull();
    expect(after.earnings_computed_at).toBeNull();
    // Cleared, not set: nothing was paid, so there is nothing to say about it.
    expect(after.hours_changed_after_payment_at).toBeNull();
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it('is idempotent — a replayed roll-up writes nulls over nulls', async () => {
    const { error } = await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: unpaidId,
      p_total_minutes: 3000,
    });

    expect(error).toBeNull();
    const after = await read(unpaidId);
    expect(after.status).toBe('submitted');
    expect(after.total_minutes).toBe(3000);
  });
});

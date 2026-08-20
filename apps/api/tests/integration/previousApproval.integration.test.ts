/**
 * @module tests/integration/previousApproval.integration.test
 *
 * Migration 111's one column and one `SET` arm, against a REAL Postgres — the
 * only place either can be proved.
 *
 * THE HOLE 102 LEFT. Its unpaid branch demotes an approved week to
 * `submitted` and nulls all four snapshot columns (D1's rule, and still the
 * right rule). What it never asked is what that costs the two people: an
 * approval is a STATEMENT — "I looked at 41h, I agreed £800.00, on 10
 * August" — and the demotion erased it, wrote no `reopen_reason` (only the
 * manual reopen does), and emitted no `shift_event`. A parent who was not
 * staring at the Hours screen opened a week byte-identical to one nobody had
 * ever approved.
 *
 * A text assertion cannot reach any of this. Three things have to be true of
 * a real UPDATE and only Postgres can say so:
 *
 *  1. The bare column references on the RIGHT of the `SET` list read the OLD
 *     row — the same four values the same statement is nulling.
 *  2. `else previous_approval` keeps Saturday's receipt when Sunday's
 *     clock-out lands on the now-`submitted` week.
 *  3. The PAID branch never writes it, because that week keeps a real
 *     approval and has no receipt to leave behind.
 *
 * NOT part of `bun run test` / `bun run qc`. Run it explicitly:
 *
 *   supabase start && supabase db reset --local && eval "$(supabase status -o env |
 *     sed 's/^API_URL=/SUPABASE_URL=/;s/^ANON_KEY=/SUPABASE_ANON_KEY=/;s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_KEY=/' |
 *     sed 's/^/export /')"
 *   bun test tests/integration/previousApproval.integration.test.ts
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
const WORKED_MINUTES = 2460;

let parentId = '';
let carerId = '';
let householdId = '';

interface PreviousApprovalShape {
  approved_at: string | null;
  approved_by: string | null;
  gross_minor: number | null;
  currency: string | null;
  worked_minutes: number | null;
}

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
  previous_approval: PreviousApprovalShape | null;
  updated_at: string;
}

const COLUMNS =
  'status, total_minutes, approved_by, approved_at, gross_minor, currency, earnings, earnings_computed_at, hours_changed_after_payment_at, previous_approval, updated_at';

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

/** An approved, priced week. `earnings` carries the engine's worked basis. */
async function seedApprovedWeek(
  weekStart: string,
  earnings: unknown = {
    status: 'ok',
    gross_minor: GROSS_MINOR,
    worked_minutes: WORKED_MINUTES,
  }
): Promise<string> {
  return insertOne('timesheets', {
    household_id: householdId,
    carer_id: carerId,
    carer_display_name: 'Receipt Carer',
    week_start: weekStart,
    total_minutes: WORKED_MINUTES,
    status: 'approved',
    approved_by: parentId,
    approved_at: FROZEN_AT,
    gross_minor: GROSS_MINOR,
    currency: 'GBP',
    earnings,
    earnings_computed_at: FROZEN_AT,
  });
}

beforeAll(async () => {
  const household = await withHousehold({
    parentLabel: 'receipt-parent',
    nannyLabels: ['receipt-carer'],
  });
  householdId = household.householdId;
  parentId = household.parent?.id ?? '';
  carerId = household.nannies[0]?.id ?? '';
});

afterAll(async () => {
  if (householdId) {
    await service.from('households').delete().eq('id', householdId);
  }
  await deleteUsers([parentId, carerId]);
});

describe('roll_up_timesheet_hours — an UNPAID week keeps its receipt', () => {
  it('demotes AND copies the approval it is destroying, in one statement', async () => {
    const id = await seedApprovedWeek('2026-06-01');

    const { error } = await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: id,
      p_total_minutes: 2940,
    });
    expect(error).toBeNull();

    const after = await read(id);
    // 102's rule, unchanged: demote and clear.
    expect(after.status).toBe('submitted');
    expect(after.approved_by).toBeNull();
    expect(after.gross_minor).toBeNull();
    expect(after.earnings).toBeNull();
    // 111: the four values above, read off the OLD row by the SAME statement.
    //
    // `approved_at` is compared as an INSTANT, not a string. `jsonb_build_
    // object` serialises a timestamptz in Postgres's own form
    // ("2026-08-10T18:00:00+00:00"), not JavaScript's "Z" form — both are
    // valid ISO-8601 with an offset, which is exactly what
    // `PreviousApprovalSchema`'s `z.iso.datetime({ offset: true })` accepts
    // and what `new Date(...)` parses. Pinning the string would fail the day
    // Postgres or PostgREST normalised it differently, for no gain.
    expect(after.previous_approval).toEqual({
      approved_at: expect.any(String),
      approved_by: parentId,
      gross_minor: GROSS_MINOR,
      currency: 'GBP',
      worked_minutes: WORKED_MINUTES,
    });
    expect(
      new Date(after.previous_approval?.approved_at ?? '').toISOString()
    ).toBe(FROZEN_AT);
  });

  it('a SECOND clock-out does not erase it — `else previous_approval`', async () => {
    const id = await seedApprovedWeek('2026-06-08');

    await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: id,
      p_total_minutes: 2940,
    });
    const first = await read(id);

    // The row is `submitted` now, so the `when status = 'approved'` arm no
    // longer matches. Without the `else` this write would null the column via
    // the CASE's implicit NULL, and Sunday's clock-out would wipe Saturday's
    // receipt. The FIRST demotion out of an approval owns it.
    await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: id,
      p_total_minutes: 3000,
    });
    const second = await read(id);

    expect(second.total_minutes).toBe(3000);
    expect(second.previous_approval).toEqual(first.previous_approval);
    expect(second.previous_approval?.gross_minor).toBe(GROSS_MINOR);
  });

  it('leaves worked_minutes NULL when the snapshot has no such key', async () => {
    // A `no_arrangement` frozen snapshot carries no `worked_minutes`, and
    // `(earnings->>'worked_minutes')::int` is NULL rather than 0 — an absent
    // figure is never rendered as a zero one (docs/11-MONEY.md §4).
    const id = await seedApprovedWeek('2026-06-15', {
      status: 'no_arrangement',
      unpriced_dates: ['2026-06-15'],
    });

    await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: id,
      p_total_minutes: 2940,
    });

    const after = await read(id);
    expect(after.previous_approval?.worked_minutes).toBeNull();
    expect(after.previous_approval?.gross_minor).toBe(GROSS_MINOR);
  });

  it('writes nothing on a week that was already submitted', async () => {
    const id = await insertOne('timesheets', {
      household_id: householdId,
      carer_id: carerId,
      carer_display_name: 'Receipt Carer',
      week_start: '2026-06-22',
      total_minutes: 600,
      status: 'submitted',
    });

    await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: id,
      p_total_minutes: 900,
    });

    expect((await read(id)).previous_approval).toBeNull();
  });
});

describe('roll_up_timesheet_hours — a PAID week has no receipt to leave', () => {
  it('keeps the real approval and never writes previous_approval', async () => {
    const id = await seedApprovedWeek('2026-06-29');
    await insertOne('payments', {
      timesheet_id: id,
      household_id: householdId,
      carer_id: carerId,
      amount_minor: GROSS_MINOR,
      currency: 'GBP',
      paid_at: '2026-07-03',
      recorded_by: parentId,
    });

    const { error } = await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: id,
      p_total_minutes: 2940,
    });
    expect(error).toBeNull();

    const after = await read(id);
    expect(after.status).toBe('approved');
    expect(after.gross_minor).toBe(GROSS_MINOR);
    expect(after.hours_changed_after_payment_at).not.toBeNull();
    // Nothing was lost, so there is nothing to keep a copy of. A receipt here
    // would sit beside a LIVE approval and read as a second, contradictory
    // total for the same week.
    expect(after.previous_approval).toBeNull();
  });
});

describe('the approve write supersedes the receipt', () => {
  it('clears previous_approval when the week is approved again', async () => {
    const id = await seedApprovedWeek('2026-07-06');
    await service.rpc('roll_up_timesheet_hours', {
      p_timesheet_id: id,
      p_total_minutes: 2940,
    });
    expect((await read(id)).previous_approval).not.toBeNull();

    // The shape `approveSubmittedWithEarnings` writes. The new approval IS
    // the total now; leaving the receipt set would have the approve dialog
    // offering to replace a figure that has already been replaced.
    const { error } = await service
      .from('timesheets')
      .update({
        status: 'approved',
        query_note: null,
        reopen_reason: null,
        hours_changed_after_payment_at: null,
        previous_approval: null,
        approved_by: parentId,
        approved_at: '2026-07-13T09:00:00.000Z',
        gross_minor: 95_000,
        currency: 'GBP',
        earnings: { status: 'ok', gross_minor: 95_000, worked_minutes: 2940 },
        earnings_computed_at: '2026-07-13T09:00:00.000Z',
      })
      .eq('id', id);
    expect(error).toBeNull();

    const after = await read(id);
    expect(after.status).toBe('approved');
    expect(after.previous_approval).toBeNull();
    // 102's CHECK still binds: approved ⇒ all four columns present.
    expect(after.gross_minor).toBe(95_000);
  });
});

describe('111 does not disturb 102', () => {
  it('the approved-has-snapshot CHECK ignores previous_approval entirely', async () => {
    const id = await seedApprovedWeek('2026-07-20');

    // An approved row carrying a receipt is not a state the code produces,
    // but the CHECK names four columns and this is not one of them — so it
    // must be accepted rather than silently constrained.
    const { error } = await service
      .from('timesheets')
      .update({
        previous_approval: {
          approved_at: FROZEN_AT,
          approved_by: parentId,
          gross_minor: 1,
          currency: 'GBP',
          worked_minutes: 1,
        },
      })
      .eq('id', id);

    expect(error).toBeNull();
    expect((await read(id)).status).toBe('approved');
  });
});

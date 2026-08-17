/**
 * @module tests/integration/recordTimesheetPayment.integration.test
 *
 * `record_timesheet_payment` (077 → 085 → 102) against a REAL Postgres.
 *
 * Everything this function guards lives behind `select ... for update` on the
 * week's timesheet row, which is exactly the part no unit test can reach: the
 * repository test pins the function name and its six `p_*` parameters, and
 * `tests/unit/migration102PaidWeekGuards.test.ts` pins the SQL text — but only
 * a real database can answer "does the over-gross refusal actually refuse",
 * "does a submitted week actually come back not_payable", and "does a repeated
 * intent key actually return the FIRST row instead of writing a second one".
 *
 * That last one is the whole reason 102 exists. `payments` is append-only with
 * no edit path: a double-tapped POST used to file two real rows for money that
 * moved once, bounded only by the week's gross, and the parent's only way out
 * was to notice and record a correction.
 *
 * NOT part of `bun run test` / `bun run qc` — those sweep `tests/unit` only.
 * Run it explicitly:
 *
 *   supabase start && supabase db reset --local && eval "$(supabase status -o env |
 *     sed 's/^API_URL=/SUPABASE_URL=/;s/^ANON_KEY=/SUPABASE_ANON_KEY=/;s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_KEY=/' |
 *     sed 's/^/export /')"
 *   bun test tests/integration/recordTimesheetPayment.integration.test.ts
 *
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

/** The frozen figure every payment below is bounded by. */
const GROSS_MINOR = 80_000;
const FROZEN_AT = '2026-08-10T18:00:00.000Z';

let parentId = '';
let carerId = '';
let householdId = '';
/** Approved and priced — the only shape a payment may land on. */
let approvedId = '';
/** Submitted, never approved — the `not_payable` target. */
let submittedId = '';

interface RpcOutcome {
  outcome: string;
  payment?: {
    id: string;
    amount_minor: number;
    idempotency_key: string | null;
  };
  already_paid_minor?: number;
  gross_minor?: number;
  status?: string | null;
}

async function recordPayment(args: {
  timesheetId: string;
  amountMinor: number;
  idempotencyKey?: string | null;
}): Promise<RpcOutcome> {
  const { data, error } = await service.rpc('record_timesheet_payment', {
    p_timesheet_id: args.timesheetId,
    p_amount_minor: args.amountMinor,
    p_paid_at: '2026-08-14',
    p_method_note: 'Bank transfer',
    p_recorded_by: parentId,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) {
    throw new Error(`record_timesheet_payment failed: ${error.message}`);
  }
  return data as RpcOutcome;
}

async function countPayments(timesheetId: string): Promise<number> {
  const { data, error } = await service
    .from('payments')
    .select('id')
    .eq('timesheet_id', timesheetId);
  if (error) {
    throw new Error(`count payments failed: ${error.message}`);
  }
  return (data ?? []).length;
}

beforeAll(async () => {
  const household = await withHousehold({
    parentLabel: 'pay-parent',
    nannyLabels: ['pay-carer'],
  });
  householdId = household.householdId;
  parentId = household.parent?.id ?? '';
  carerId = household.nannies[0]?.id ?? '';

  // Approved AND priced: since 102 the two are inseparable
  // (`timesheets_approved_has_snapshot`), which is itself what makes the
  // function's "approved or not_payable" re-check meaningful.
  approvedId = await insertOne('timesheets', {
    household_id: householdId,
    carer_id: carerId,
    carer_display_name: 'Pay Carer',
    week_start: '2026-08-10',
    total_minutes: 2400,
    status: 'approved',
    approved_by: parentId,
    approved_at: FROZEN_AT,
    gross_minor: GROSS_MINOR,
    currency: 'GBP',
    earnings: { status: 'ok', gross_minor: GROSS_MINOR },
    earnings_computed_at: FROZEN_AT,
  });

  submittedId = await insertOne('timesheets', {
    household_id: householdId,
    carer_id: carerId,
    carer_display_name: 'Pay Carer',
    week_start: '2026-08-17',
    total_minutes: 2400,
    status: 'submitted',
  });
});

afterAll(async () => {
  if (householdId) {
    await service.from('households').delete().eq('id', householdId);
  }
  await deleteUsers([parentId, carerId]);
});

describe('record_timesheet_payment — the gross ceiling', () => {
  it('REFUSES more than the frozen gross, and reports the figures the lock saw', async () => {
    const outcome = await recordPayment({
      timesheetId: approvedId,
      amountMinor: GROSS_MINOR + 1,
    });

    expect(outcome.outcome).toBe('exceeds_gross');
    // Refused, never clamped (`docs/11-MONEY.md` §1): a trimmed payment would
    // be a record of money that did not move.
    expect(outcome.already_paid_minor).toBe(0);
    expect(outcome.gross_minor).toBe(GROSS_MINOR);
    expect(await countPayments(approvedId)).toBe(0);
  });

  it('accepts a partial payment, then refuses the one that would tip it over', async () => {
    const first = await recordPayment({
      timesheetId: approvedId,
      amountMinor: 50_000,
    });
    expect(first.outcome).toBe('recorded');

    const second = await recordPayment({
      timesheetId: approvedId,
      amountMinor: 30_001,
    });
    expect(second.outcome).toBe('exceeds_gross');
    expect(second.already_paid_minor).toBe(50_000);

    // Exactly the accepted one is on the ledger.
    expect(await countPayments(approvedId)).toBe(1);
  });
});

describe('record_timesheet_payment — a week that is not payable', () => {
  it('answers not_payable on a submitted week, carrying the status it actually read', async () => {
    const outcome = await recordPayment({
      timesheetId: submittedId,
      amountMinor: 1_000,
    });

    expect(outcome.outcome).toBe('not_payable');
    expect(outcome.status).toBe('submitted');
    expect(await countPayments(submittedId)).toBe(0);
  });

  it('answers not_payable for a week that does not exist at all', async () => {
    const outcome = await recordPayment({
      timesheetId: '00000000-0000-0000-0000-000000000000',
      amountMinor: 1_000,
    });

    expect(outcome.outcome).toBe('not_payable');
  });
});

describe('record_timesheet_payment — the intent key (102)', () => {
  const KEY = '9f1d4b3a-0000-4000-8000-abcdefabcdef';

  it('writes ONE row for a repeated key and hands back the row it already wrote', async () => {
    const before = await countPayments(approvedId);

    const first = await recordPayment({
      timesheetId: approvedId,
      amountMinor: 10_000,
      idempotencyKey: KEY,
    });
    const second = await recordPayment({
      timesheetId: approvedId,
      amountMinor: 10_000,
      idempotencyKey: KEY,
    });

    expect(first.outcome).toBe('recorded');
    // 'recorded', NOT an error: `payments` is append-only, so a retry that
    // reads as a failure ends with the parent recording the payment a second
    // time and then having to correct it.
    expect(second.outcome).toBe('recorded');
    expect(second.payment?.id).toBe(first.payment?.id ?? '');
    expect(await countPayments(approvedId)).toBe(before + 1);
  });

  it('stamps the key on the row, so the dedupe survives a restart', async () => {
    const key = '9f1d4b3a-0001-4000-8000-abcdefabcdef';
    const outcome = await recordPayment({
      timesheetId: approvedId,
      amountMinor: 5_000,
      idempotencyKey: key,
    });

    expect(outcome.payment?.idempotency_key).toBe(key);
  });

  it('does NOT dedupe two payments that carry no key — the index is partial', async () => {
    // Two null keys must not collide with each other, or an older client
    // would be unable to record a second partial payment at all.
    const before = await countPayments(approvedId);

    await recordPayment({ timesheetId: approvedId, amountMinor: 1_000 });
    await recordPayment({ timesheetId: approvedId, amountMinor: 1_000 });

    expect(await countPayments(approvedId)).toBe(before + 2);
  });

  it('answers a keyed row BEFORE it asks whether the week is payable', async () => {
    // The key check sits ahead of the payable re-check on purpose: telling a
    // parent "nothing happened" about money that is already on the ledger is
    // the one lie an append-only table cannot take back.
    //
    // Since 102 a paid week can no longer BECOME unpayable — the trigger
    // refuses the reopen and the CHECK refuses an approved week without its
    // snapshot — so the ordering is staged the only way left: a keyed row
    // written directly against a week that was never approved. The row is
    // seeded through the service client deliberately; this is a hostile state,
    // not a supported transition.
    const key = '9f1d4b3a-0002-4000-8000-abcdefabcdef';
    const seededId = await insertOne('payments', {
      timesheet_id: submittedId,
      household_id: householdId,
      carer_id: carerId,
      amount_minor: 4_200,
      currency: 'GBP',
      paid_at: '2026-08-20',
      recorded_by: parentId,
      idempotency_key: key,
    });

    const retry = await recordPayment({
      timesheetId: submittedId,
      amountMinor: 4_200,
      idempotencyKey: key,
    });

    expect(retry.outcome).toBe('recorded');
    expect(retry.payment?.id).toBe(seededId);
    expect(await countPayments(submittedId)).toBe(1);
  });
});

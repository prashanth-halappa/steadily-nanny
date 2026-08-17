import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * Payment repository tests — the settlement ledger's data access
 * (migration 067, `docs/11-MONEY.md`).
 *
 * Same discipline as `ptoLedgerRepository.test.ts`/
 * `payArrangementRepository.test.ts`: the fake PostgREST chain ACTUALLY
 * applies `eq`/`order` to an in-memory row set rather than handing back a
 * canned response, so these tests prove the real filter shape
 * (`timesheet_id`, and ONLY this timesheet's rows) instead of proving that a
 * mock returns what it was told to return.
 *
 * `listForTimesheet` is the number every paid-to-date read is built on, so its
 * scoping is the security-relevant part: a sum that leaked another week's
 * rows would refuse legitimate payments; a sum that dropped rows would let a
 * week be paid twice. It survives 077 — the CSV export and the paid-state
 * reads still ask for it — even though the WRITE gate no longer uses it.
 *
 * `recordForTimesheet` is the 077 wiring. The arithmetic it guards happens in
 * Postgres, under a row lock no unit test can reach, so what is testable here
 * is the seam: the real function name, the real five `p_*` parameter names,
 * and the mapping from each jsonb payload to the typed outcome the service
 * branches on. The name and the parameters are asserted verbatim against what
 * `077_payment_atomic_insert.sql` actually declares (D53) — a mock-shaped name
 * would pass this file and 500 in production.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_TS_RECENT_BASE = new Date(Date.now() - 1 * DAY_MS);
FIXTURE_TS_RECENT_BASE.setUTCHours(9, 0, 0, 0);
const FIXTURE_TS_MORNING = FIXTURE_TS_RECENT_BASE.toISOString();
const FIXTURE_TS_EVENING = new Date(
  FIXTURE_TS_RECENT_BASE.getTime() + 8 * 60 * 60 * 1000
).toISOString();

interface FakeRow {
  [key: string]: unknown;
}

let PaymentRepository: any;
let mockSupabaseService: any;
let lastCalls: { method: string; args: unknown[] }[] = [];
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  const orderKeys: [string, boolean][] = [];

  const resolveRows = (): FakeRow[] => {
    let out = rows.filter(row =>
      eqFilters.every(([key, value]) => row[key] === value)
    );
    for (const [key, ascending] of [...orderKeys].reverse()) {
      out = [...out].sort((a, b) => {
        const left = String(a[key]);
        const right = String(b[key]);
        if (left === right) return 0;
        return (left < right ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    return out;
  };

  const record = (method: string, ...args: unknown[]) => {
    lastCalls.push({ method, args });
  };

  const chain: any = {
    select: mock((...args: unknown[]) => {
      record('select', ...args);
      return chain;
    }),
    eq: mock((key: string, value: unknown) => {
      record('eq', key, value);
      eqFilters.push([key, value]);
      return chain;
    }),
    order: mock((key: string, opts?: { ascending?: boolean }) => {
      record('order', key, opts);
      orderKeys.push([key, opts?.ascending !== false]);
      return chain;
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: error ? null : resolveRows(), error }).then(
        resolve
      ),
  };
  return chain;
}

function paymentRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'pay-1',
    timesheet_id: 'ts-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    amount_minor: 5_000,
    currency: 'GBP',
    paid_at: '2026-08-10',
    method_note: 'Bank transfer',
    recorded_by: 'parent-1',
    created_at: FIXTURE_TS,
    ...overrides,
  };
}

function withRows(rows: FakeRow[], error: unknown = null): void {
  mockSupabaseService.from.mockImplementation(() =>
    createFakeQuery(rows, error)
  );
}

/**
 * Stand-in for `public.record_timesheet_payment` (077). It records the call
 * and answers with whatever payload the test is pinning — the function's own
 * behaviour (lock, sum, refuse, insert) is pinned by
 * `tests/unit/migration077PaymentAtomicInsert.test.ts` against the SQL source,
 * because it cannot be reached from here.
 */
function withRpc(data: unknown, error: unknown = null): void {
  mockSupabaseService.rpc.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: error ? null : data, error };
    }
  );
}

const RECORD_ENTRY = {
  amount_minor: 5_000,
  paid_at: '2026-08-11',
  method_note: 'Bank transfer',
  recorded_by: 'parent-1',
};

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = {
      from: mock(() => createFakeQuery([])),
      rpc: mock(async () => ({ data: null, error: null })),
    };
    return { supabase: obj, supabaseService: obj };
  });

  ({ PaymentRepository } = await import(
    '../../../../../src/domains/pay/repositories/paymentRepository'
  ));

  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  lastCalls = [];
  rpcCalls = [];
  mockSupabaseService.from.mockClear();
  mockSupabaseService.rpc.mockClear?.();
});

describe('PaymentRepository.listForTimesheet', () => {
  it('returns only the rows for THIS timesheet', async () => {
    withRows([
      paymentRow({ id: 'pay-1', amount_minor: 5_000 }),
      paymentRow({
        id: 'pay-other',
        timesheet_id: 'ts-2',
        amount_minor: 99_000,
      }),
    ]);

    const rows = await new PaymentRepository().listForTimesheet('ts-1');

    expect(rows.map((r: FakeRow) => r.id)).toEqual(['pay-1']);
    expect(lastCalls).toContainEqual({
      method: 'eq',
      args: ['timesheet_id', 'ts-1'],
    });
  });

  it('orders oldest settlement first, so a partial-payment history reads forwards', async () => {
    withRows([
      paymentRow({ id: 'pay-late', paid_at: '2026-08-12' }),
      paymentRow({ id: 'pay-early', paid_at: '2026-08-09' }),
    ]);

    const rows = await new PaymentRepository().listForTimesheet('ts-1');

    expect(rows.map((r: FakeRow) => r.id)).toEqual(['pay-early', 'pay-late']);
  });

  it('returns [] when the week has never been paid against', async () => {
    withRows([]);
    expect(await new PaymentRepository().listForTimesheet('ts-1')).toEqual([]);
  });

  it('throws a DatabaseError when the query fails', async () => {
    withRows([], { message: 'boom' });
    await expect(
      new PaymentRepository().listForTimesheet('ts-1')
    ).rejects.toThrow('Failed to list payments for timesheet');
  });
});

describe('PaymentRepository.listForHousehold', () => {
  it('returns only THIS household’s rows — the filter is mandatory under bypassed RLS', async () => {
    withRows([
      paymentRow({ id: 'pay-mine' }),
      paymentRow({ id: 'pay-other-household', household_id: 'h2' }),
    ]);

    const rows = await new PaymentRepository().listForHousehold('h1');

    expect(rows.map((r: FakeRow) => r.id)).toEqual(['pay-mine']);
    expect(lastCalls).toContainEqual({
      method: 'eq',
      args: ['household_id', 'h1'],
    });
  });

  it('narrows to ONE carer when a carerId is given', async () => {
    withRows([
      paymentRow({ id: 'pay-carer-1', carer_id: 'carer-1' }),
      paymentRow({ id: 'pay-carer-2', carer_id: 'carer-2' }),
    ]);

    const rows = await new PaymentRepository().listForHousehold(
      'h1',
      'carer-1'
    );

    expect(rows.map((r: FakeRow) => r.id)).toEqual(['pay-carer-1']);
    expect(lastCalls).toContainEqual({
      method: 'eq',
      args: ['carer_id', 'carer-1'],
    });
  });

  it('applies NO carer filter when none is given', async () => {
    withRows([paymentRow({ id: 'pay-1' })]);

    await new PaymentRepository().listForHousehold('h1');

    expect(
      lastCalls.filter(c => c.method === 'eq').map(c => c.args[0])
    ).toEqual(['household_id']);
  });

  it('orders NEWEST settlement first — history across weeks reads backwards', async () => {
    withRows([
      paymentRow({ id: 'pay-early', paid_at: '2026-08-04' }),
      paymentRow({ id: 'pay-late', paid_at: '2026-08-11' }),
    ]);

    const rows = await new PaymentRepository().listForHousehold('h1');

    expect(rows.map((r: FakeRow) => r.id)).toEqual(['pay-late', 'pay-early']);
  });

  it('breaks a same-day tie on created_at, newest first', async () => {
    withRows([
      paymentRow({
        id: 'pay-first',
        paid_at: '2026-08-11',
        created_at: FIXTURE_TS_MORNING,
      }),
      paymentRow({
        id: 'pay-second',
        paid_at: '2026-08-11',
        created_at: FIXTURE_TS_EVENING,
      }),
    ]);

    const rows = await new PaymentRepository().listForHousehold('h1');

    expect(rows.map((r: FakeRow) => r.id)).toEqual(['pay-second', 'pay-first']);
  });

  it('returns [] for a household that has never paid anyone', async () => {
    withRows([]);
    expect(await new PaymentRepository().listForHousehold('h1')).toEqual([]);
  });

  it('throws a DatabaseError when the query fails', async () => {
    withRows([], { message: 'boom' });
    await expect(
      new PaymentRepository().listForHousehold('h1')
    ).rejects.toThrow('Failed to list payments for household');
  });
});

// ---------------------------------------------------------------------------
// 077 — the sum and the insert are one statement behind a row lock.
// ---------------------------------------------------------------------------

describe('PaymentRepository.recordForTimesheet', () => {
  it('calls the REAL function name with the REAL six parameter names', async () => {
    withRpc({ outcome: 'recorded', payment: paymentRow() });

    await new PaymentRepository().recordForTimesheet('ts-1', RECORD_ENTRY);

    expect(rpcCalls[0]?.name).toBe('record_timesheet_payment');
    expect(rpcCalls[0]?.args).toEqual({
      p_timesheet_id: 'ts-1',
      p_amount_minor: 5_000,
      p_paid_at: '2026-08-11',
      p_method_note: 'Bank transfer',
      p_recorded_by: 'parent-1',
      // Explicit null rather than omitted, for the same reason `method_note`
      // is: 102's sixth parameter is DEFAULTED, and a missing key in the
      // PostgREST body would bind the default silently. Sending it says "this
      // client had no intent key", which is a different fact from "this
      // client is older than 102" and is worth being able to read.
      p_idempotency_key: null,
    });
  });

  it('passes an intent key through when the client minted one (102)', async () => {
    withRpc({ outcome: 'recorded', payment: paymentRow() });

    await new PaymentRepository().recordForTimesheet('ts-1', {
      ...RECORD_ENTRY,
      idempotency_key: '11111111-2222-3333-4444-555555555555',
    });

    expect(rpcCalls[0]?.args.p_idempotency_key).toBe(
      '11111111-2222-3333-4444-555555555555'
    );
  });

  it('maps the FIRST payment back when the key repeats — a retry is a success, not a duplicate', async () => {
    // The function answers 'recorded' with the row the first attempt wrote
    // (102). `payments` is append-only, so the alternative — an error the
    // client has to interpret — ends with a parent recording the payment
    // again and then having to correct it.
    withRpc({
      outcome: 'recorded',
      payment: paymentRow({ id: 'pay-first', amount_minor: 5_000 }),
    });

    const result = await new PaymentRepository().recordForTimesheet('ts-1', {
      ...RECORD_ENTRY,
      idempotency_key: '11111111-2222-3333-4444-555555555555',
    });

    expect(result).toEqual({
      outcome: 'recorded',
      payment: expect.objectContaining({ id: 'pay-first' }),
    });
  });

  it('sends NOTHING that describes the week — 077 stamps those from the locked row', async () => {
    withRpc({ outcome: 'recorded', payment: paymentRow() });

    await new PaymentRepository().recordForTimesheet('ts-1', RECORD_ENTRY);

    const args = Object.keys(rpcCalls[0]?.args ?? {});
    expect(args).not.toContain('p_household_id');
    expect(args).not.toContain('p_carer_id');
    expect(args).not.toContain('p_currency');
  });

  it('passes an absent method_note through as an explicit null', async () => {
    withRpc({ outcome: 'recorded', payment: paymentRow() });

    await new PaymentRepository().recordForTimesheet('ts-1', {
      ...RECORD_ENTRY,
      method_note: null,
    });

    expect(rpcCalls[0]?.args.p_method_note).toBeNull();
  });

  it('maps a recorded payload to the recorded outcome, carrying the row', async () => {
    withRpc({
      outcome: 'recorded',
      payment: paymentRow({ id: 'pay-new', amount_minor: 5_000 }),
    });

    const result = await new PaymentRepository().recordForTimesheet(
      'ts-1',
      RECORD_ENTRY
    );

    expect(result).toEqual({
      outcome: 'recorded',
      payment: expect.objectContaining({ id: 'pay-new', amount_minor: 5_000 }),
    });
  });

  it('maps an exceeds_gross payload to the under-lock figures the error reports', async () => {
    withRpc({
      outcome: 'exceeds_gross',
      already_paid_minor: 50_000,
      gross_minor: 80_000,
    });

    const result = await new PaymentRepository().recordForTimesheet(
      'ts-1',
      RECORD_ENTRY
    );

    expect(result).toEqual({
      outcome: 'exceeds_gross',
      alreadyPaidMinor: 50_000,
      grossMinor: 80_000,
    });
  });

  it('maps a not_payable payload, carrying the status the locked row actually had', async () => {
    withRpc({ outcome: 'not_payable', status: 'open' });

    const result = await new PaymentRepository().recordForTimesheet(
      'ts-1',
      RECORD_ENTRY
    );

    expect(result).toEqual({ outcome: 'not_payable', status: 'open' });
  });

  it('survives a not_payable payload with no status (the week vanished under the lock)', async () => {
    withRpc({ outcome: 'not_payable' });

    const result = await new PaymentRepository().recordForTimesheet(
      'ts-1',
      RECORD_ENTRY
    );

    expect(result).toEqual({ outcome: 'not_payable', status: null });
  });

  it('throws a DatabaseError when the RPC itself fails', async () => {
    withRpc(null, { message: 'boom' });

    await expect(
      new PaymentRepository().recordForTimesheet('ts-1', RECORD_ENTRY)
    ).rejects.toThrow('Failed to record payment');
  });

  it('refuses a recorded payload with no row rather than reporting not_payable', async () => {
    withRpc({ outcome: 'recorded' });

    await expect(
      new PaymentRepository().recordForTimesheet('ts-1', RECORD_ENTRY)
    ).rejects.toThrow('Unrecognised payment outcome');
  });

  it('refuses an empty answer rather than reporting not_payable', async () => {
    withRpc(null);

    await expect(
      new PaymentRepository().recordForTimesheet('ts-1', RECORD_ENTRY)
    ).rejects.toThrow('Unrecognised payment outcome');
  });
});

// ---------------------------------------------------------------------------
// 085 — the correction seam. Untested until now (audit gap #2): every other
// outcome mapping in this file was pinned while the function name and the six
// `p_*` parameter names it is reached by were not, and a mock-shaped name
// passes a unit test and 500s in production (D53). Asserted verbatim against
// what `085_payment_corrections.sql` declares.
// ---------------------------------------------------------------------------

const CORRECTION_ENTRY = {
  // ALREADY NEGATIVE here — the service negates the positive magnitude the
  // wire carries, so every layer below it sees the number that will be stored.
  amount_minor: -5_000,
  paid_at: '2026-08-12',
  reason: 'recorded twice',
  recorded_by: 'parent-1',
};

describe('PaymentRepository.recordCorrection', () => {
  it('calls the REAL function name with the REAL six parameter names', async () => {
    withRpc({ outcome: 'recorded', correction: paymentRow() });

    await new PaymentRepository().recordCorrection(
      'ts-1',
      'pay-1',
      CORRECTION_ENTRY
    );

    expect(rpcCalls[0]?.name).toBe('record_payment_correction');
    expect(rpcCalls[0]?.args).toEqual({
      p_timesheet_id: 'ts-1',
      p_corrects_payment_id: 'pay-1',
      p_amount_minor: -5_000,
      p_paid_at: '2026-08-12',
      p_reason: 'recorded twice',
      p_recorded_by: 'parent-1',
    });
  });

  it('sends NOTHING that describes the money — 085 stamps those from the ORIGINAL payment', async () => {
    withRpc({ outcome: 'recorded', correction: paymentRow() });

    await new PaymentRepository().recordCorrection(
      'ts-1',
      'pay-1',
      CORRECTION_ENTRY
    );

    const args = Object.keys(rpcCalls[0]?.args ?? {});
    expect(args).not.toContain('p_household_id');
    expect(args).not.toContain('p_carer_id');
    expect(args).not.toContain('p_currency');
    expect(args).not.toContain('p_kind');
  });

  it('maps a recorded payload to the recorded outcome, carrying the negative row', async () => {
    withRpc({
      outcome: 'recorded',
      correction: paymentRow({
        id: 'corr-1',
        amount_minor: -5_000,
        kind: 'correction',
      }),
    });

    expect(
      await new PaymentRepository().recordCorrection(
        'ts-1',
        'pay-1',
        CORRECTION_ENTRY
      )
    ).toEqual({
      outcome: 'recorded',
      correction: expect.objectContaining({
        id: 'corr-1',
        amount_minor: -5_000,
      }),
    });
  });

  it('maps exceeds_original to the under-lock figures the error reports', async () => {
    withRpc({
      outcome: 'exceeds_original',
      original_amount_minor: 46_200,
      remaining_minor: 12_000,
    });

    expect(
      await new PaymentRepository().recordCorrection(
        'ts-1',
        'pay-1',
        CORRECTION_ENTRY
      )
    ).toEqual({
      outcome: 'exceeds_original',
      originalAmountMinor: 46_200,
      remainingMinor: 12_000,
    });
  });

  it('maps not_correctable, carrying the reason the lock actually saw', async () => {
    withRpc({ outcome: 'not_correctable', reason: 'not_a_payment' });

    expect(
      await new PaymentRepository().recordCorrection(
        'ts-1',
        'pay-1',
        CORRECTION_ENTRY
      )
    ).toEqual({ outcome: 'not_correctable', reason: 'not_a_payment' });
  });

  it('refuses an unrecognised answer rather than reporting nothing happened', async () => {
    withRpc({ outcome: 'recorded' });

    await expect(
      new PaymentRepository().recordCorrection(
        'ts-1',
        'pay-1',
        CORRECTION_ENTRY
      )
    ).rejects.toThrow('Unrecognised correction outcome');
  });

  it('throws a DatabaseError when the RPC itself fails', async () => {
    withRpc(null, { message: 'boom' });

    await expect(
      new PaymentRepository().recordCorrection(
        'ts-1',
        'pay-1',
        CORRECTION_ENTRY
      )
    ).rejects.toThrow('Failed to record correction');
  });
});

// ---------------------------------------------------------------------------
// P8 — append-only, structurally (`docs/AS-BUILT-PAYMENT.md` §7).
//
// The audit's words: "`BaseRepository.update`/`delete` are inherited and
// callable on every append-only table including `payments`, running as service
// role where RLS cannot stop them. Append-only there is enforced by nobody
// having written the call." A comment saying "nothing should start" is not a
// guard; a method that throws is.
// ---------------------------------------------------------------------------

describe('PaymentRepository — append-only', () => {
  it('refuses update: a payment is a fact about money that already moved', async () => {
    await expect(
      new PaymentRepository().update('pay-1', { amount_minor: 1 })
    ).rejects.toThrow('payments is append-only');
  });

  it('refuses delete: the way back is a correction row, not an erasure', async () => {
    await expect(new PaymentRepository().delete('pay-1')).rejects.toThrow(
      'payments is append-only'
    );
  });

  it('never reaches the database to find that out', async () => {
    // The refusal is structural, so it must not depend on a query failing.
    mockSupabaseService.from.mockClear();
    await new PaymentRepository().update('pay-1', {}).catch(() => undefined);
    await new PaymentRepository().delete('pay-1').catch(() => undefined);
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });
});

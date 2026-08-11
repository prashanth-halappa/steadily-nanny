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
    created_at: '2026-08-10T09:00:00.000Z',
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
        created_at: '2026-08-11T09:00:00.000Z',
      }),
      paymentRow({
        id: 'pay-second',
        paid_at: '2026-08-11',
        created_at: '2026-08-11T17:00:00.000Z',
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
  it('calls the REAL function name with the REAL five parameter names', async () => {
    withRpc({ outcome: 'recorded', payment: paymentRow() });

    await new PaymentRepository().recordForTimesheet('ts-1', RECORD_ENTRY);

    expect(rpcCalls[0]?.name).toBe('record_timesheet_payment');
    expect(rpcCalls[0]?.args).toEqual({
      p_timesheet_id: 'ts-1',
      p_amount_minor: 5_000,
      p_paid_at: '2026-08-11',
      p_method_note: 'Bank transfer',
      p_recorded_by: 'parent-1',
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

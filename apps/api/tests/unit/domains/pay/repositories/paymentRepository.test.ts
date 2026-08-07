import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * Payment repository tests — the settlement ledger's data access
 * (migration 066, `docs/11-MONEY.md`).
 *
 * Same discipline as `ptoLedgerRepository.test.ts`/
 * `payArrangementRepository.test.ts`: the fake PostgREST chain ACTUALLY
 * applies `eq`/`order` to an in-memory row set rather than handing back a
 * canned response, so these tests prove the real filter shape
 * (`timesheet_id`, and ONLY this timesheet's rows) instead of proving that a
 * mock returns what it was told to return.
 *
 * `sumForTimesheet` is the number the over-payment gate is built on, so its
 * scoping is the security-relevant part: a sum that leaked another week's
 * rows would refuse legitimate payments; a sum that dropped rows would let a
 * week be paid twice.
 */

interface FakeRow {
  [key: string]: unknown;
}

let PaymentRepository: any;
let mockSupabaseService: any;
let lastCalls: { method: string; args: unknown[] }[] = [];

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

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createFakeQuery([])) };
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
  mockSupabaseService.from.mockClear();
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

describe('PaymentRepository.sumForTimesheet', () => {
  it('sums only THIS timesheet’s rows — the figure the over-payment gate is built on', async () => {
    withRows([
      paymentRow({ id: 'pay-1', amount_minor: 5_000 }),
      paymentRow({ id: 'pay-2', amount_minor: 2_500 }),
      paymentRow({
        id: 'pay-other-week',
        timesheet_id: 'ts-2',
        amount_minor: 100_000,
      }),
    ]);

    expect(await new PaymentRepository().sumForTimesheet('ts-1')).toBe(7_500);
  });

  it('is 0 for an unpaid week, never null — the gate adds to it', async () => {
    withRows([]);
    expect(await new PaymentRepository().sumForTimesheet('ts-1')).toBe(0);
  });
});

import { describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import {
  PaymentExceedsGrossError,
  PaymentNotFoundError,
  PaymentWeekNotApprovedError,
} from '../../../../../src/domains/pay/errors/payErrors';
import { PaymentCommandService } from '../../../../../src/domains/pay/services/paymentCommandService';

/**
 * `paymentCommandService.create` — the ONLY write path into the settlement
 * ledger (migration 067, `docs/11-MONEY.md` §1/§3/§8/§9).
 *
 * Four gates, and each one is a typed error rather than a silent correction:
 * the caller must be a parent of the week's household, the week must be
 * APPROVED with a frozen gross, the running total must not exceed that gross
 * (REFUSED, never clamped), and every server-derived field on the row —
 * household, carer, currency, recorder — comes off the timesheet or the
 * caller, never off the request body.
 *
 * Gate 4 MOVED INTO POSTGRES (migration 077). It used to be a read-then-write
 * here — `sumForTimesheet`, compare, `create` — which two parents tapping
 * "Record payment" in the same instant could both pass. The sum, the refusal
 * and the insert are now one `record_timesheet_payment` call behind a
 * `FOR UPDATE` lock on the week, so this file's job for gate 4 is no longer
 * the arithmetic (the database owns it, and the SQL is pinned by
 * `tests/unit/migration077PaymentAtomicInsert.test.ts`) but the MAPPING: the
 * service must reach the rpc rather than the old path, and must turn each of
 * its three outcomes into the right typed error with the figures the lock saw.
 */

const APPROVED_TIMESHEET = {
  id: 'ts-1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  week_start: '2026-08-03',
  total_minutes: 2_400,
  status: 'approved',
  approved_by: 'parent-1',
  approved_at: '2026-08-10T09:00:00.000Z',
  query_note: null,
  reopen_reason: null,
  gross_minor: 80_000,
  currency: 'GBP',
  earnings: { status: 'ok' },
  earnings_computed_at: '2026-08-10T09:00:00.000Z',
  created_at: 't',
  updated_at: 't',
};

const VALID_INPUT = {
  amount_minor: 5_000,
  paid_at: '2026-08-11',
  method_note: 'Bank transfer',
};

/** What 077 answers with on the happy path — the row it actually inserted. */
function recordedPayment(overrides: Record<string, unknown> = {}): any {
  return {
    outcome: 'recorded',
    payment: {
      id: 'pay-new',
      timesheet_id: 'ts-1',
      household_id: 'h1',
      carer_id: 'carer-1',
      amount_minor: 5_000,
      currency: 'GBP',
      paid_at: '2026-08-11',
      method_note: 'Bank transfer',
      recorded_by: 'parent-1',
      created_at: '2026-08-11T10:00:00.000Z',
      ...overrides,
    },
  };
}

function makePaymentRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForTimesheet: mock(async () => []),
    sumForTimesheet: mock(async () => 0),
    create: mock(async (data: Record<string, unknown>) => ({
      id: 'pay-new',
      created_at: '2026-08-11T10:00:00.000Z',
      ...data,
    })),
    recordForTimesheet: mock(
      async (_timesheetId: string, entry: Record<string, unknown>) =>
        recordedPayment(entry)
    ),
    ...overrides,
  };
}

function makeTimesheetRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => ({ ...APPROVED_TIMESHEET })),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'parent-1',
      role: 'parent',
      status: 'active',
    })),
    ...overrides,
  };
}

function makePush(overrides: Record<string, unknown> = {}): any {
  return { notifyUser: mock(() => undefined), ...overrides };
}

function makeService(overrides: Record<string, unknown> = {}): any {
  const deps = {
    paymentRepo: makePaymentRepo(),
    timesheetRepo: makeTimesheetRepo(),
    memberRepo: makeMemberRepo(),
    push: makePush(),
    ...overrides,
  };
  return {
    ...deps,
    svc: new PaymentCommandService(
      deps.paymentRepo,
      deps.timesheetRepo,
      deps.memberRepo,
      deps.push
    ),
  };
}

// =============================================================================
// Gate (a) — the week must exist and the caller must be a parent of it
// =============================================================================

describe('PaymentCommandService.create — membership + role gate', () => {
  it('a missing timesheet is PaymentNotFoundError, and nothing is written', async () => {
    const { svc, paymentRepo } = makeService({
      timesheetRepo: makeTimesheetRepo({ findById: mock(async () => null) }),
    });

    await expect(
      svc.create('parent-1', 'ts-nope', VALID_INPUT)
    ).rejects.toThrow(PaymentNotFoundError);
    expect(paymentRepo.recordForTimesheet).not.toHaveBeenCalled();
  });

  it('a non-member gets the SAME PaymentNotFoundError — existence is never leaked', async () => {
    const { svc, paymentRepo } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => null),
      }),
    });

    await expect(svc.create('stranger-1', 'ts-1', VALID_INPUT)).rejects.toThrow(
      PaymentNotFoundError
    );
    expect(paymentRepo.recordForTimesheet).not.toHaveBeenCalled();
  });

  it('an active NANNY member is refused with the 403-shaped NotAHouseholdParentError', async () => {
    const { svc, paymentRepo } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm2',
          household_id: 'h1',
          user_id: 'carer-1',
          role: 'nanny',
          status: 'active',
        })),
      }),
    });

    const error = await svc
      .create('carer-1', 'ts-1', VALID_INPUT)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAHouseholdParentError);
    expect((error as { statusCode: number }).statusCode).toBe(403);
    expect(paymentRepo.recordForTimesheet).not.toHaveBeenCalled();
  });

  it('an active HELPER member is refused too — a helper never touches money', async () => {
    const { svc, paymentRepo } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm3',
          household_id: 'h1',
          user_id: 'helper-1',
          role: 'helper',
          status: 'active',
        })),
      }),
    });

    await expect(svc.create('helper-1', 'ts-1', VALID_INPUT)).rejects.toThrow(
      NotAHouseholdParentError
    );
    expect(paymentRepo.recordForTimesheet).not.toHaveBeenCalled();
  });

  it('an owner may record a payment', async () => {
    const { svc, paymentRepo } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm4',
          household_id: 'h1',
          user_id: 'owner-1',
          role: 'owner',
          status: 'active',
        })),
      }),
    });

    await svc.create('owner-1', 'ts-1', VALID_INPUT);

    expect(paymentRepo.recordForTimesheet).toHaveBeenCalled();
  });

  it('membership is resolved against the TIMESHEET’s household, not a client-supplied one', async () => {
    const { svc, memberRepo } = makeService();

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(memberRepo.findActiveMembership).toHaveBeenCalledWith(
      'h1',
      'parent-1'
    );
  });
});

// =============================================================================
// Gate (b) — approved, with a frozen gross
// =============================================================================

describe('PaymentCommandService.create — the week must be approved and priced', () => {
  for (const status of ['open', 'submitted', 'queried']) {
    it(`refuses a '${status}' week — there is no settled figure to pay against`, async () => {
      const { svc, paymentRepo } = makeService({
        timesheetRepo: makeTimesheetRepo({
          findById: mock(async () => ({ ...APPROVED_TIMESHEET, status })),
        }),
      });

      const error = await svc
        .create('parent-1', 'ts-1', VALID_INPUT)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PaymentWeekNotApprovedError);
      expect((error as { statusCode: number }).statusCode).toBe(409);
      expect(paymentRepo.recordForTimesheet).not.toHaveBeenCalled();
    });
  }

  it('refuses an approved week whose gross snapshot is NULL (a legacy/unpriceable week)', async () => {
    const { svc, paymentRepo } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findById: mock(async () => ({
          ...APPROVED_TIMESHEET,
          gross_minor: null,
          currency: null,
        })),
      }),
    });

    const error = await svc
      .create('parent-1', 'ts-1', VALID_INPUT)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentWeekNotApprovedError);
    expect((error as { metadata: { reason: string } }).metadata.reason).toBe(
      'no_frozen_gross'
    );
    expect(paymentRepo.recordForTimesheet).not.toHaveBeenCalled();
  });

  it('refuses an approved week whose frozen currency is NULL — nothing to stamp', async () => {
    const { svc, paymentRepo } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findById: mock(async () => ({
          ...APPROVED_TIMESHEET,
          currency: null,
        })),
      }),
    });

    await expect(svc.create('parent-1', 'ts-1', VALID_INPUT)).rejects.toThrow(
      PaymentWeekNotApprovedError
    );
    expect(paymentRepo.recordForTimesheet).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Gate (d) — sum(payments) <= gross, now decided under a row lock (077).
// =============================================================================

describe('PaymentCommandService.create — the over-payment gate is the RPC', () => {
  it('records through record_timesheet_payment, not the old read-then-write pair', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(paymentRepo.recordForTimesheet).toHaveBeenCalledTimes(1);
    // The window 077 closed: summing here and inserting there.
    expect(paymentRepo.sumForTimesheet).not.toHaveBeenCalled();
    expect(paymentRepo.create).not.toHaveBeenCalled();
  });

  it('sends the amount, the settlement date, the note and the recorder — and the week id', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(paymentRepo.recordForTimesheet).toHaveBeenCalledWith('ts-1', {
      amount_minor: 5_000,
      paid_at: '2026-08-11',
      method_note: 'Bank transfer',
      recorded_by: 'parent-1',
    });
  });

  it('turns exceeds_gross into a 400 carrying the figures the LOCK saw, not the ones a pre-read did', async () => {
    const { svc } = makeService({
      paymentRepo: makePaymentRepo({
        recordForTimesheet: mock(async () => ({
          outcome: 'exceeds_gross',
          alreadyPaidMinor: 50_000,
          grossMinor: 80_000,
        })),
      }),
    });

    const error = await svc
      .create('parent-1', 'ts-1', { ...VALID_INPUT, amount_minor: 30_001 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentExceedsGrossError);
    expect((error as { statusCode: number }).statusCode).toBe(400);
    expect(
      (error as { metadata: Record<string, unknown> }).metadata
    ).toMatchObject({
      timesheetId: 'ts-1',
      amountMinor: 30_001,
      alreadyPaidMinor: 50_000,
      grossMinor: 80_000,
    });
  });

  it('turns not_payable into the 409 — a reopen landed between gate 3 and the lock', async () => {
    const { svc } = makeService({
      paymentRepo: makePaymentRepo({
        recordForTimesheet: mock(async () => ({
          outcome: 'not_payable',
          status: 'open',
        })),
      }),
    });

    const error = await svc
      .create('parent-1', 'ts-1', VALID_INPUT)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentWeekNotApprovedError);
    expect((error as { statusCode: number }).statusCode).toBe(409);
    expect(
      (error as { metadata: Record<string, unknown> }).metadata
    ).toMatchObject({ status: 'open' });
  });

  it('pushes the carer only when the row was actually recorded', async () => {
    const { svc, push } = makeService();

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(push.notifyUser).toHaveBeenCalledTimes(1);
  });

  for (const outcome of [
    { outcome: 'exceeds_gross', alreadyPaidMinor: 0, grossMinor: 80_000 },
    { outcome: 'not_payable', status: 'open' },
  ]) {
    it(`sends NO push when the write is refused with ${outcome.outcome}`, async () => {
      const { svc, push } = makeService({
        paymentRepo: makePaymentRepo({
          recordForTimesheet: mock(async () => outcome),
        }),
      });

      await svc.create('parent-1', 'ts-1', VALID_INPUT).catch(() => undefined);

      expect(push.notifyUser).not.toHaveBeenCalled();
    });
  }
});

// =============================================================================
// Gate (e) — nothing describing the week crosses the wire into the write
// =============================================================================

describe('PaymentCommandService.create — the week describes itself', () => {
  it('sends no household, carer or currency — 077 stamps them off the locked row', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.create('parent-1', 'ts-1', {
      ...VALID_INPUT,
      // A client that invents fields must not be able to set any of them.
      currency: 'USD',
      household_id: 'h-evil',
      carer_id: 'carer-evil',
    } as never);

    const entry = paymentRepo.recordForTimesheet.mock.calls[0][1];
    expect(Object.keys(entry).sort()).toEqual([
      'amount_minor',
      'method_note',
      'paid_at',
      'recorded_by',
    ]);
  });

  it('records the AUTHENTICATED caller, never a body-supplied one', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.create('parent-1', 'ts-1', {
      ...VALID_INPUT,
      recorded_by: 'someone-else',
    } as never);

    expect(paymentRepo.recordForTimesheet).toHaveBeenCalledWith(
      'ts-1',
      expect.objectContaining({ recorded_by: 'parent-1' })
    );
  });

  it('passes a method_note the caller did not send as an explicit null', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.create('parent-1', 'ts-1', {
      amount_minor: 1_000,
      paid_at: '2026-08-11',
    });

    expect(paymentRepo.recordForTimesheet).toHaveBeenCalledWith(
      'ts-1',
      expect.objectContaining({ method_note: null })
    );
  });

  it('targets the week the URL named, not one the body could redirect', async () => {
    const { svc, paymentRepo } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findById: mock(async () => ({ ...APPROVED_TIMESHEET, id: 'ts-real' })),
      }),
    });

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(paymentRepo.recordForTimesheet).toHaveBeenCalledWith(
      'ts-real',
      expect.anything()
    );
  });

  it('returns the row the database inserted, currency and all', async () => {
    const { svc } = makeService();

    const payment = await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(payment).toMatchObject({
      id: 'pay-new',
      timesheet_id: 'ts-1',
      currency: 'GBP',
      recorded_by: 'parent-1',
    });
  });
});

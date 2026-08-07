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
 * ledger (migration 066, `docs/11-MONEY.md` §1/§3/§8/§9).
 *
 * Four gates, and each one is a typed error rather than a silent correction:
 * the caller must be a parent of the week's household, the week must be
 * APPROVED with a frozen gross, the running total must not exceed that gross
 * (REFUSED, never clamped), and every server-derived field on the row —
 * household, carer, currency, recorder — comes off the timesheet or the
 * caller, never off the request body.
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

function makePaymentRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForTimesheet: mock(async () => []),
    sumForTimesheet: mock(async () => 0),
    create: mock(async (data: Record<string, unknown>) => ({
      id: 'pay-new',
      created_at: '2026-08-11T10:00:00.000Z',
      ...data,
    })),
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
    expect(paymentRepo.create).not.toHaveBeenCalled();
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
    expect(paymentRepo.create).not.toHaveBeenCalled();
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
    expect(paymentRepo.create).not.toHaveBeenCalled();
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
    expect(paymentRepo.create).not.toHaveBeenCalled();
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

    expect(paymentRepo.create).toHaveBeenCalled();
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
      expect(paymentRepo.create).not.toHaveBeenCalled();
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
    expect(paymentRepo.create).not.toHaveBeenCalled();
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
    expect(paymentRepo.create).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Gate (c) — sum(payments) <= gross. REFUSED, never clamped.
// =============================================================================

describe('PaymentCommandService.create — the over-payment gate', () => {
  it('allows a payment landing EXACTLY on the frozen gross', async () => {
    const { svc, paymentRepo } = makeService();

    const payment = await svc.create('parent-1', 'ts-1', {
      ...VALID_INPUT,
      amount_minor: 80_000,
    });

    expect(payment.amount_minor).toBe(80_000);
    expect(paymentRepo.create).toHaveBeenCalled();
  });

  it('refuses gross + 1 — the boundary, and it is a REFUSAL, not a clamp', async () => {
    const { svc, paymentRepo } = makeService();

    const error = await svc
      .create('parent-1', 'ts-1', { ...VALID_INPUT, amount_minor: 80_001 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentExceedsGrossError);
    expect((error as { statusCode: number }).statusCode).toBe(400);
    expect(
      (error as { metadata: Record<string, unknown> }).metadata
    ).toMatchObject({
      timesheetId: 'ts-1',
      amountMinor: 80_001,
      alreadyPaidMinor: 0,
      grossMinor: 80_000,
    });
    // The whole point: no row is written at a trimmed amount.
    expect(paymentRepo.create).not.toHaveBeenCalled();
  });

  it('accumulates partial payments — a second payment is measured against what is already paid', async () => {
    const { svc, paymentRepo } = makeService({
      paymentRepo: makePaymentRepo({
        sumForTimesheet: mock(async () => 50_000),
      }),
    });

    await svc.create('parent-1', 'ts-1', {
      ...VALID_INPUT,
      amount_minor: 30_000,
    });

    expect(paymentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount_minor: 30_000 })
    );
  });

  it('refuses the partial payment that would take the running total one penny past gross', async () => {
    const { svc, paymentRepo } = makeService({
      paymentRepo: makePaymentRepo({
        sumForTimesheet: mock(async () => 50_000),
      }),
    });

    const error = await svc
      .create('parent-1', 'ts-1', { ...VALID_INPUT, amount_minor: 30_001 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentExceedsGrossError);
    expect(
      (error as { metadata: Record<string, unknown> }).metadata
    ).toMatchObject({ alreadyPaidMinor: 50_000, grossMinor: 80_000 });
    expect(paymentRepo.create).not.toHaveBeenCalled();
  });

  it('sums the payments of THIS timesheet only', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(paymentRepo.sumForTimesheet).toHaveBeenCalledWith('ts-1');
  });
});

// =============================================================================
// Gate (d) — every server-derived field is stamped, never accepted
// =============================================================================

describe('PaymentCommandService.create — stamped fields', () => {
  it('stamps household, carer, currency and recorder from the timesheet and the caller', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(paymentRepo.create).toHaveBeenCalledWith({
      timesheet_id: 'ts-1',
      household_id: 'h1',
      carer_id: 'carer-1',
      amount_minor: 5_000,
      currency: 'GBP',
      paid_at: '2026-08-11',
      method_note: 'Bank transfer',
      recorded_by: 'parent-1',
    });
  });

  it('stamps the week’s frozen currency, never a client-supplied one', async () => {
    const { svc, paymentRepo } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findById: mock(async () => ({
          ...APPROVED_TIMESHEET,
          currency: 'EUR',
        })),
      }),
    });

    await svc.create('parent-1', 'ts-1', {
      ...VALID_INPUT,
      // A client that invents a currency field must not be able to set one.
      currency: 'USD',
    } as never);

    expect(paymentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'EUR' })
    );
  });

  it('omits a method_note the caller did not send, as an explicit null', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.create('parent-1', 'ts-1', {
      amount_minor: 1_000,
      paid_at: '2026-08-11',
    });

    expect(paymentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ method_note: null })
    );
  });

  it('carries a NULL carer through (033: she deleted her account, the record survives)', async () => {
    const { svc, paymentRepo } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findById: mock(async () => ({
          ...APPROVED_TIMESHEET,
          carer_id: null,
        })),
      }),
    });

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(paymentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ carer_id: null })
    );
  });

  it('returns the created row', async () => {
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

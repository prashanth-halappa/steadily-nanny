/**
 * `paymentCommandService.correct` — the offsetting row 067 forbade
 * (D-20, gap P3, migration 085, attention spec §4.1).
 *
 * `PaymentDetailSheet` has told parents in production that "a correction is
 * recorded as another payment" while `amount_minor >= 1` made that row
 * impossible to write. This is the write path that makes the sentence true,
 * and the shape it takes is load-bearing in four ways this file pins:
 *
 * 1. **CORRECTING IS THE PAYER'S ACT.** Parents and the owner only — the same
 *    `PAYMENT_WRITE_ROLES` set that records a payment in the first place. A
 *    nanny who thinks a payment is wrong says so on the week thread (3-T1's
 *    "This doesn't look right"); she does not edit the household's ledger.
 * 2. **THE WIRE IS A POSITIVE MAGNITUDE, THE ROW IS NEGATIVE.** The parent
 *    types 462.00 into a field labelled "Amount to reverse"; the service
 *    negates it on the way to the RPC. Asking a human to type a minus sign to
 *    un-record a payment is how a correction ends up adding money.
 * 3. **REFUSED, NEVER CLAMPED, AT THE ORIGINAL'S CEILING.** A reversal larger
 *    than what is LEFT of the original comes back with the figures the lock
 *    saw, never trimmed to fit (`docs/11-MONEY.md` §1).
 * 4. **NOTHING FROM THE BODY DESCRIBES THE MONEY.** household, carer, currency
 *    and the `correction` kind are stamped inside 085's function from the row
 *    it locks; only the amount, the date and the reason cross the wire.
 *
 * Gate ordering matters as much as the gates: a non-member must get the 404
 * that a stranger gets, before the role check can tell them they are "not a
 * parent OF THIS HOUSEHOLD" and confirm the week is real.
 *
 * The concurrency half lives in Postgres and is pinned as source by
 * `tests/unit/migration085PaymentCorrections.test.ts`; what this file owns is
 * the gates and the OUTCOME MAPPING.
 */
import { describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import {
  PaymentCorrectionExceedsOriginalError,
  PaymentNotCorrectableError,
  PaymentNotFoundError,
} from '../../../../../src/domains/pay/errors/payErrors';
import { PaymentCommandService } from '../../../../../src/domains/pay/services/paymentCommandService';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_TS_RECENT_OFFSET = new Date(Date.now() - 1 * DAY_MS)
  .toISOString()
  .replace('.000Z', '+00:00');

const APPROVED_TIMESHEET = {
  id: 'ts-1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  week_start: '2026-08-03',
  total_minutes: 2_400,
  status: 'approved',
  approved_by: 'parent-1',
  approved_at: FIXTURE_TS,
  query_note: null,
  reopen_reason: null,
  gross_minor: 80_000,
  currency: 'GBP',
  earnings: { status: 'ok' },
  earnings_computed_at: FIXTURE_TS,
  created_at: 't',
  updated_at: 't',
};

/** David's actual incident: one Zelle transfer of £462.00, recorded twice. */
const VALID_CORRECTION = {
  amount_minor: 46_200,
  paid_at: '2026-08-18',
  reason: 'recorded twice',
};

/** What 085 answers with on the happy path — the negative row it inserted. */
function recordedCorrection(overrides: Record<string, unknown> = {}): any {
  return {
    outcome: 'recorded',
    correction: {
      id: 'corr-new',
      timesheet_id: 'ts-1',
      household_id: 'h1',
      carer_id: 'carer-1',
      amount_minor: -46_200,
      kind: 'correction',
      corrects_payment_id: 'pay-1',
      correction_reason: 'recorded twice',
      currency: 'GBP',
      paid_at: '2026-08-18',
      method_note: null,
      recorded_by: 'parent-1',
      // Both serialisations appear across this suite on purpose (GOLDEN #25):
      // PostgREST hands back `+00:00`, JS writes `.000Z`, and a fixture in one
      // style alone proves nothing about code that compares them.
      created_at: FIXTURE_TS_RECENT_OFFSET,
      ...overrides,
    },
  };
}

function makePaymentRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForTimesheet: mock(async () => []),
    recordForTimesheet: mock(async () => ({ outcome: 'recorded' })),
    recordCorrection: mock(
      async (
        _timesheetId: string,
        _paymentId: string,
        entry: Record<string, unknown>
      ) => recordedCorrection({ amount_minor: entry.amount_minor })
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

function makeMemberRepo(
  role = 'parent',
  overrides: Record<string, unknown> = {}
): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'parent-1',
      role,
      status: 'active',
    })),
    ...overrides,
  };
}

function makeService(overrides: Record<string, unknown> = {}): any {
  const deps = {
    paymentRepo: makePaymentRepo(),
    timesheetRepo: makeTimesheetRepo(),
    memberRepo: makeMemberRepo(),
    push: { notifyUser: mock(() => undefined) },
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
// The gates, in order — a stranger must never learn the week is real
// =============================================================================

describe('PaymentCommandService.correct — who may correct', () => {
  it('404s a missing week, without reaching the ledger at all', async () => {
    const { svc, paymentRepo } = makeService({
      timesheetRepo: makeTimesheetRepo({ findById: mock(async () => null) }),
    });

    await expect(
      svc.correct('parent-1', 'ts-missing', 'pay-1', VALID_CORRECTION)
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(paymentRepo.recordCorrection).not.toHaveBeenCalled();
  });

  it('404s a non-member — the same error a missing week gives, never a 403', async () => {
    const { svc } = makeService({
      memberRepo: makeMemberRepo('parent', {
        findActiveMembership: mock(async () => null),
      }),
    });

    await expect(
      svc.correct('stranger-1', 'ts-1', 'pay-1', VALID_CORRECTION)
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it('403s the week’s own NANNY — correcting is the payer’s act (§4.1)', async () => {
    const { svc, paymentRepo } = makeService({
      memberRepo: makeMemberRepo('nanny'),
    });

    await expect(
      svc.correct('carer-1', 'ts-1', 'pay-1', VALID_CORRECTION)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(paymentRepo.recordCorrection).not.toHaveBeenCalled();
  });

  it('403s a helper — she cannot touch money at all', async () => {
    const { svc } = makeService({ memberRepo: makeMemberRepo('helper') });

    await expect(
      svc.correct('helper-1', 'ts-1', 'pay-1', VALID_CORRECTION)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('lets an OWNER correct, not only a parent', async () => {
    const { svc } = makeService({ memberRepo: makeMemberRepo('owner') });

    await expect(
      svc.correct('owner-1', 'ts-1', 'pay-1', VALID_CORRECTION)
    ).resolves.toBeDefined();
  });
});

// =============================================================================
// A reopened week is still correctable — spec §4.1, P16
// =============================================================================

describe('PaymentCommandService.correct — week state', () => {
  for (const status of ['submitted', 'queried'] as const) {
    it(`corrects on a ${status} (reopened) week — the payment still happened`, async () => {
      const { svc, paymentRepo } = makeService({
        timesheetRepo: makeTimesheetRepo({
          findById: mock(async () => ({
            ...APPROVED_TIMESHEET,
            status,
            gross_minor: null,
            currency: null,
          })),
        }),
      });

      await expect(
        svc.correct('parent-1', 'ts-1', 'pay-1', VALID_CORRECTION)
      ).resolves.toBeDefined();
      expect(paymentRepo.recordCorrection).toHaveBeenCalled();
    });
  }
});

// =============================================================================
// The sign flip and the stamped fields
// =============================================================================

describe('PaymentCommandService.correct — the row it asks for', () => {
  it('NEGATES the positive wire magnitude: 46_200 in, -46_200 to the RPC', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.correct('parent-1', 'ts-1', 'pay-1', VALID_CORRECTION);

    expect(paymentRepo.recordCorrection).toHaveBeenCalledWith(
      'ts-1',
      'pay-1',
      expect.objectContaining({ amount_minor: -46_200 })
    );
  });

  it('sends only the settlement’s own fields — no household, carer or currency', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.correct('parent-1', 'ts-1', 'pay-1', VALID_CORRECTION);

    const entry = paymentRepo.recordCorrection.mock.calls[0][2];
    expect(Object.keys(entry).sort()).toEqual([
      'amount_minor',
      'paid_at',
      'reason',
      'recorded_by',
    ]);
  });

  it('stamps recorded_by from the AUTHENTICATED caller, never the body', async () => {
    const { svc, paymentRepo } = makeService();

    await svc.correct('parent-1', 'ts-1', 'pay-1', {
      ...VALID_CORRECTION,
      // A body field that must be ignored entirely.
      recorded_by: 'someone-else',
    } as never);

    expect(paymentRepo.recordCorrection.mock.calls[0][2].recorded_by).toBe(
      'parent-1'
    );
  });

  it('returns the correction row the database actually inserted', async () => {
    const { svc } = makeService();

    const row = await svc.correct(
      'parent-1',
      'ts-1',
      'pay-1',
      VALID_CORRECTION
    );

    expect(row.amount_minor).toBe(-46_200);
    expect(row.kind).toBe('correction');
    expect(row.corrects_payment_id).toBe('pay-1');
    expect(row.correction_reason).toBe('recorded twice');
  });
});

// =============================================================================
// Outcome mapping — refuse, never clamp
// =============================================================================

describe('PaymentCommandService.correct — refusals carry the figures', () => {
  it('maps exceeds_original onto a typed error with BOTH figures the lock saw', async () => {
    const { svc } = makeService({
      paymentRepo: makePaymentRepo({
        recordCorrection: mock(async () => ({
          outcome: 'exceeds_original',
          originalAmountMinor: 46_200,
          remainingMinor: 34_200,
        })),
      }),
    });

    // £462.00 was paid, £120.00 of it is already reversed, so £342.00 is left.
    // Asking to reverse the full £462.00 is refused — not trimmed to £342.00.
    const error = await svc
      .correct('parent-1', 'ts-1', 'pay-1', VALID_CORRECTION)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentCorrectionExceedsOriginalError);
    expect(
      (error as PaymentCorrectionExceedsOriginalError).metadata
    ).toMatchObject({
      amountMinor: 46_200,
      originalAmountMinor: 46_200,
      remainingMinor: 34_200,
    });
  });

  it('maps not_correctable onto its own 409, carrying the database’s reason', async () => {
    const { svc } = makeService({
      paymentRepo: makePaymentRepo({
        recordCorrection: mock(async () => ({
          outcome: 'not_correctable',
          reason: 'not_a_payment',
        })),
      }),
    });

    const error = await svc
      .correct('parent-1', 'ts-1', 'corr-1', VALID_CORRECTION)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentNotCorrectableError);
    expect((error as PaymentNotCorrectableError).metadata).toMatchObject({
      reason: 'not_a_payment',
    });
  });

  it('never clamps: a refused correction writes nothing and returns nothing', async () => {
    const recordCorrection = mock(async () => ({
      outcome: 'exceeds_original',
      originalAmountMinor: 46_200,
      remainingMinor: 0,
    }));
    const { svc } = makeService({
      paymentRepo: makePaymentRepo({ recordCorrection }),
    });

    await expect(
      svc.correct('parent-1', 'ts-1', 'pay-1', VALID_CORRECTION)
    ).rejects.toBeInstanceOf(PaymentCorrectionExceedsOriginalError);
    // One attempt, no retry at a trimmed figure.
    expect(recordCorrection).toHaveBeenCalledTimes(1);
  });
});

/**
 * Push notification for a recorded settlement (066 payments).
 *
 * The carer is the one who was just paid, so she — and only she — is
 * notified, the same `notifyUser` discipline as `PAY_TERMS_SET`
 * (`payArrangementCommandService`) rather than a household fan-out.
 *
 * The `data` payload's field names are a CONTRACT with the mobile route map
 * (`hoursHref` reads `householdId`/`weekStart`/`timesheetId`), so they are
 * asserted exactly rather than with `objectContaining` on one key.
 *
 * `mock.module()` runs inside `beforeAll` BEFORE the dynamic import of the
 * service — docs/09-TESTING.md §4, and the same boilerplate as
 * `expenseCommandService.pushes.test.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';

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

let PaymentCommandService: typeof import('../../../../../src/domains/pay/services/paymentCommandService').PaymentCommandService;
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  notifyHouseholdParents = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/notification/services/householdPush',
    () => ({ notifyUser, notifyHouseholdParents })
  );

  ({ PaymentCommandService } = await import(
    '../../../../../src/domains/pay/services/paymentCommandService'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
});

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

/** Built WITHOUT a push override, so the default (the mocked module) is used. */
function makeService(overrides: Record<string, unknown> = {}): any {
  const deps = {
    paymentRepo: makePaymentRepo(),
    timesheetRepo: makeTimesheetRepo(),
    memberRepo: makeMemberRepo(),
    ...overrides,
  };
  return {
    ...deps,
    svc: new PaymentCommandService(
      deps.paymentRepo as never,
      deps.timesheetRepo as never,
      deps.memberRepo as never
    ),
  };
}

describe('paymentCommandService.create — PAYMENT_RECORDED push', () => {
  it('pushes the CARER with exactly householdId / weekStart / timesheetId', async () => {
    const { svc } = makeService();

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(notifyUser).toHaveBeenCalledTimes(1);
    const [userId, payload] = notifyUser.mock.calls[0] as [
      string,
      { title: string; body: string; data: Record<string, unknown> },
    ];
    expect(userId).toBe('carer-1');
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.PAYMENT_RECORDED,
      householdId: 'h1',
      weekStart: '2026-08-03',
      timesheetId: 'ts-1',
    });
    expect(payload.title.length).toBeGreaterThan(0);
    expect(payload.body.length).toBeGreaterThan(0);
  });

  it('never fans out to the household — a settlement is the carer’s news, not everyone’s', async () => {
    const { svc } = makeService();

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('sends nothing when the week has no carer (033 account deletion)', async () => {
    const { svc } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findById: mock(async () => ({ ...APPROVED_TIMESHEET, carer_id: null })),
      }),
    });

    await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('does not push when the write was refused by a gate', async () => {
    const { svc } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findById: mock(async () => ({
          ...APPROVED_TIMESHEET,
          status: 'submitted',
        })),
      }),
    });

    await svc.create('parent-1', 'ts-1', VALID_INPUT).catch(() => undefined);

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('still returns the recorded payment when the push throws', async () => {
    notifyUser.mockImplementation(() => {
      throw new Error('expo down');
    });
    const { svc } = makeService();

    const payment = await svc.create('parent-1', 'ts-1', VALID_INPUT);

    expect(payment.id).toBe('pay-new');
    notifyUser.mockImplementation(() => undefined);
  });
});

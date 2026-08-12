/**
 * Push notification for a settled reimbursement (N6, migration 086).
 *
 * The carer is the one who was repaid, so she — and only she — is notified,
 * the same `notifyUser` discipline as `PAYMENT_RECORDED` rather than a
 * household fan-out.
 *
 * A8 DISCIPLINE: the title and body carry NO FIGURE. A lock-screen preview is
 * not a private surface, and "£146.00 repaid" on a shared phone is a money
 * fact leaking to whoever is holding it. The digits test below is the
 * enforcement, not a comment.
 *
 * `mock.module()` runs inside `beforeAll` BEFORE the dynamic import of the
 * service — docs/09-TESTING.md §4, the same boilerplate as
 * `paymentCommandService.pushes.test.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';

let ReimbursementSettlementService: typeof import('../../../../../src/domains/pay/services/reimbursementSettlementService').ReimbursementSettlementService;
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  notifyHouseholdParents = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/notification/services/householdPush',
    () => ({ notifyUser, notifyHouseholdParents })
  );

  ({ ReimbursementSettlementService } = await import(
    '../../../../../src/domains/pay/services/reimbursementSettlementService'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_TS_OFFSET = FIXTURE_TS.replace('.000Z', '+00:00');

const VALID_INPUT = {
  carer_id: 'carer-1',
  week_start: '2026-08-03',
  settled_at: '2026-08-10',
  note: 'Cash on Friday',
};

function makeSettlementRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForWeek: mock(async () => []),
    create: mock(async (data: Record<string, unknown>) => ({
      id: 'set-new',
      note: null,
      created_at: FIXTURE_TS_OFFSET,
      ...data,
    })),
    ...overrides,
  };
}

function makeExpenseRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listApprovedForWeek: mock(async () => [
      {
        id: 'e1',
        household_id: 'h1',
        carer_id: 'carer-1',
        amount_minor: 14_600,
        currency: 'GBP',
        status: 'approved',
        local_date: '2026-08-04',
      },
    ]),
    ...overrides,
  };
}

function makeMemberRepo(): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'parent-1',
      role: 'parent',
      status: 'active',
    })),
    findMembershipAnyStatus: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'parent-1',
      role: 'parent',
      status: 'active',
    })),
  };
}

function makeHouseholdRepo(): any {
  return {
    findById: mock(async () => ({
      id: 'h1',
      timezone: 'Europe/London',
      week_starts_on: 1,
      currency: 'GBP',
    })),
  };
}

/** Built WITHOUT a push override, so the default (the mocked module) is used. */
function makeService(overrides: Record<string, unknown> = {}): any {
  const deps = {
    settlementRepo: makeSettlementRepo(),
    expenseRepo: makeExpenseRepo(),
    ...overrides,
  };
  return {
    ...deps,
    svc: new ReimbursementSettlementService(
      deps.settlementRepo as never,
      deps.expenseRepo as never,
      makeMemberRepo() as never,
      makeHouseholdRepo() as never
    ),
  };
}

describe('reimbursementSettlementService.create — REIMBURSEMENT_SETTLED push', () => {
  it('pushes the CARER with exactly type / householdId / weekStart', async () => {
    const { svc } = makeService();

    await svc.create('parent-1', 'h1', VALID_INPUT);

    expect(notifyUser).toHaveBeenCalledTimes(1);
    const [userId, payload] = notifyUser.mock.calls[0] as [
      string,
      { title: string; body: string; data: Record<string, unknown> },
    ];
    expect(userId).toBe('carer-1');
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.REIMBURSEMENT_SETTLED,
      householdId: 'h1',
      weekStart: '2026-08-03',
    });
  });

  it('carries NO figure — no digit appears in the title or the body (A8)', async () => {
    const { svc } = makeService();

    await svc.create('parent-1', 'h1', VALID_INPUT);

    const [, payload] = notifyUser.mock.calls[0] as [
      string,
      { title: string; body: string },
    ];
    expect(payload.title).not.toMatch(/\d/);
    expect(payload.body).not.toMatch(/\d/);
    expect(payload.title.length).toBeGreaterThan(0);
    expect(payload.body.length).toBeGreaterThan(0);
  });

  it('never fans out to the household — a repayment is the carer’s news', async () => {
    const { svc } = makeService();

    await svc.create('parent-1', 'h1', VALID_INPUT);

    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('sends nothing when the settled row has no carer (033 account deletion)', async () => {
    const { svc } = makeService({
      settlementRepo: makeSettlementRepo({
        create: mock(async (data: Record<string, unknown>) => ({
          id: 'set-new',
          ...data,
          carer_id: null,
        })),
      }),
    });

    await svc.create('parent-1', 'h1', VALID_INPUT);

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('does not push when the write was refused by the zero-sum gate', async () => {
    const { svc } = makeService({
      expenseRepo: makeExpenseRepo({
        listApprovedForWeek: mock(async () => []),
      }),
    });

    await svc.create('parent-1', 'h1', VALID_INPUT).catch(() => undefined);

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('still returns the settlement when the push throws', async () => {
    notifyUser.mockImplementation(() => {
      throw new Error('expo down');
    });
    const { svc } = makeService();

    const settlement = await svc.create('parent-1', 'h1', VALID_INPUT);

    expect(settlement.id).toBe('set-new');
    notifyUser.mockImplementation(() => undefined);
  });
});

/**
 * Push notifications for expense submit / review (money leg).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';

function expenseRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'exp-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    local_date: '2026-08-04',
    kind: 'expense',
    description: 'Nappies',
    amount_minor: 1200,
    miles: null,
    currency: 'GBP',
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    carer_display_name: 'Nia Rowe',
    created_at: '2026-08-04T09:00:00.000Z',
    updated_at: '2026-08-04T09:00:00.000Z',
    ...overrides,
  };
}

function arrangement(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'pa-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    rate_minor: 1500,
    bill_rate_minor: null,
    currency: 'GBP',
    overtime_threshold_minutes: null,
    overtime_multiplier: 1.5,
    guaranteed_minutes_per_week: null,
    pto_entitlement_minutes_per_year: null,
    mileage_rate_per_mile_minor: 45,
    cancellation_paid_within_hours: null,
    valid_from: '2026-01-01',
    carer_display_name: 'Nia Rowe',
    note: null,
    created_by: 'parent-1',
    created_at: '2026-01-01T09:00:00.000Z',
    ...overrides,
  };
}

function member(
  role: string,
  userId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: `m-${userId}`,
    household_id: 'h1',
    user_id: userId,
    role,
    status: 'active',
    display_name_override: null,
    ...overrides,
  };
}

const PARENT = member('parent', 'parent-1');
const NANNY = member('nanny', 'carer-1');

let ExpenseCommandService: typeof import('../../../../../src/domains/pay/services/expenseCommandService').ExpenseCommandService;
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  notifyHouseholdParents = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/notification/services/householdPush',
    () => ({
      notifyUser,
      notifyHouseholdParents,
    })
  );

  ({ ExpenseCommandService } = await import(
    '../../../../../src/domains/pay/services/expenseCommandService'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
});

function makeExpenseRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...expenseRow(),
      ...data,
      id: 'exp-new',
    })),
    findById: mock(async () => expenseRow()),
    // Since 051 the review write answers with an OUTCOME, not a row-or-null —
    // the week freeze is evaluated inside the write and has to be told apart
    // from a lost status race (F-B4-1).
    reviewPending: mock(
      async (_id: string, _h: string, patch: Record<string, unknown>) => ({
        outcome: 'reviewed',
        expense: { ...expenseRow(), ...patch },
      })
    ),
    ...overrides,
  };
}

function makeArrangementRepo(overrides: Record<string, unknown> = {}): any {
  return {
    effectiveOn: mock(async () => arrangement()),
    ...overrides,
  };
}

function makeMemberRepo(byUserId: Record<string, unknown>): any {
  return {
    findActiveMembership: mock(
      async (_householdId: string, userId: string) => byUserId[userId] ?? null
    ),
  };
}

function makeUserService(name: string | null = 'Nia Rowe'): any {
  return {
    getProfileById: mock(async () => (name === null ? null : { name })),
  };
}

function makeTimesheetRepo(): any {
  return {
    findByWeek: mock(async () => null),
  };
}

function service(
  parts: {
    expenseRepo?: any;
    arrangementRepo?: any;
    members?: Record<string, unknown>;
  } = {}
): any {
  return new ExpenseCommandService(
    parts.expenseRepo ?? makeExpenseRepo(),
    parts.arrangementRepo ?? makeArrangementRepo(),
    makeMemberRepo(parts.members ?? { 'carer-1': NANNY, 'parent-1': PARENT }),
    makeUserService(),
    makeTimesheetRepo()
  );
}

describe('ExpenseCommandService.create — push', () => {
  it('notifies household parents with EXPENSE_SUBMITTED for an expense claim', async () => {
    const svc = service({ members: { 'carer-1': NANNY } });
    await svc.create('carer-1', 'h1', {
      kind: 'expense',
      local_date: '2026-08-04',
      description: 'Nappies',
      amount_minor: 1200,
      currency: 'GBP',
    });

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        body: 'Your nanny submitted an expense.',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.EXPENSE_SUBMITTED,
          householdId: 'h1',
          weekStart: '2026-08-03',
        }),
      })
    );
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('notifies household parents with a mileage-specific body for a mileage claim', async () => {
    const svc = service({ members: { 'carer-1': NANNY } });
    await svc.create('carer-1', 'h1', {
      kind: 'mileage',
      local_date: '2026-08-04',
      description: 'Nursery run',
      miles: 12.3,
      currency: 'GBP',
    });

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        body: 'Your nanny submitted a mileage claim.',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.EXPENSE_SUBMITTED,
        }),
      })
    );
  });

  it('a push failure never fails the create write', async () => {
    notifyHouseholdParents.mockImplementationOnce(() => {
      throw new Error('expo down');
    });
    const svc = service({ members: { 'carer-1': NANNY } });
    const created = await svc.create('carer-1', 'h1', {
      kind: 'expense',
      local_date: '2026-08-04',
      description: 'Nappies',
      amount_minor: 1200,
      currency: 'GBP',
    });
    expect(created.id).toBe('exp-new');
  });
});

describe('ExpenseCommandService.review — push', () => {
  it('notifies the carer with EXPENSE_APPROVED when a claim is approved', async () => {
    const expenseRepo = makeExpenseRepo({
      reviewPending: mock(
        async (_id: string, _h: string, patch: Record<string, unknown>) => ({
          outcome: 'reviewed',
          expense: { ...expenseRow(), ...patch, status: 'approved' },
        })
      ),
    });
    const svc = service({ expenseRepo });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        body: 'A parent approved your expense.',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.EXPENSE_APPROVED,
          householdId: 'h1',
          weekStart: '2026-08-03',
        }),
      })
    );
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('notifies the carer with EXPENSE_REJECTED when a claim is rejected', async () => {
    const expenseRepo = makeExpenseRepo({
      reviewPending: mock(
        async (_id: string, _h: string, patch: Record<string, unknown>) => ({
          outcome: 'reviewed',
          expense: {
            ...expenseRow({ kind: 'mileage', miles: 10, amount_minor: null }),
            ...patch,
            status: 'rejected',
          },
        })
      ),
    });
    const svc = service({ expenseRepo });
    await svc.review('parent-1', 'exp-1', { status: 'rejected' });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        body: 'A parent rejected your mileage claim.',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.EXPENSE_REJECTED,
          householdId: 'h1',
          weekStart: '2026-08-03',
        }),
      })
    );
  });

  it('a push failure never fails the review write', async () => {
    notifyUser.mockImplementationOnce(() => {
      throw new Error('expo down');
    });
    const expenseRepo = makeExpenseRepo({
      reviewPending: mock(
        async (_id: string, _h: string, patch: Record<string, unknown>) => ({
          outcome: 'reviewed',
          expense: { ...expenseRow(), ...patch, status: 'approved' },
        })
      ),
    });
    const svc = service({ expenseRepo });
    const reviewed = await svc.review('parent-1', 'exp-1', {
      status: 'approved',
    });
    expect(reviewed.status).toBe('approved');
  });
});

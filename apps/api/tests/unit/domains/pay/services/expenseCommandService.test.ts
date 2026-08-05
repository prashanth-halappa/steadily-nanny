import { describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';
import {
  ExpenseNotEditableError,
  ExpenseNotFoundError,
  ExpenseValidationError,
} from '../../../../../src/domains/pay/errors/payErrors';
import { ExpenseCommandService } from '../../../../../src/domains/pay/services/expenseCommandService';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
const OWNER = member('owner', 'owner-1');
const NANNY = member('nanny', 'carer-1');
const OTHER_NANNY = member('nanny', 'carer-2');
const HELPER = member('helper', 'helper-1');

function makeExpenseRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...expenseRow(),
      ...data,
      id: 'exp-new',
    })),
    findById: mock(async () => expenseRow()),
    updateOwnedPending: mock(
      async (
        _id: string,
        _h: string,
        _c: string,
        patch: Record<string, unknown>
      ) => ({
        ...expenseRow(),
        ...patch,
      })
    ),
    deleteOwnedPending: mock(async () => true),
    reviewPending: mock(
      async (_id: string, _h: string, patch: Record<string, unknown>) => ({
        ...expenseRow(),
        ...patch,
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

interface ServiceParts {
  members?: Record<string, unknown>;
  expenseRepo?: any;
  arrangementRepo?: any;
  userService?: any;
}

function service(parts: ServiceParts = {}): any {
  return new ExpenseCommandService(
    parts.expenseRepo ?? makeExpenseRepo(),
    parts.arrangementRepo ?? makeArrangementRepo(),
    makeMemberRepo(parts.members ?? { 'carer-1': NANNY }),
    parts.userService ?? makeUserService()
  );
}

function expenseRequest(overrides: Record<string, unknown> = {}): any {
  return {
    kind: 'expense',
    local_date: '2026-08-04',
    description: 'Nappies',
    amount_minor: 1200,
    currency: 'GBP',
    ...overrides,
  };
}

function mileageRequest(overrides: Record<string, unknown> = {}): any {
  return {
    kind: 'mileage',
    local_date: '2026-08-04',
    description: 'Nursery run',
    miles: 12.3,
    currency: 'GBP',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ExpenseCommandService.create — carer gate', () => {
  it('the carer creates her own claim, pending', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'carer-1': NANNY } });
    const created = await svc.create('carer-1', 'h1', expenseRequest());
    expect(created.id).toBe('exp-new');
    expect(expenseRepo.create.mock.calls[0][0].status).toBe('pending');
    expect(expenseRepo.create.mock.calls[0][0].carer_id).toBe('carer-1');
  });

  it('forces status = pending even when the client tries to send approved', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'carer-1': NANNY } });
    await svc.create('carer-1', 'h1', {
      ...expenseRequest(),
      status: 'approved',
    } as any);
    expect(expenseRepo.create.mock.calls[0][0].status).toBe('pending');
  });

  it('a PARENT may not create an expense as if she were the carer', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({
      expenseRepo,
      members: { 'parent-1': PARENT, 'carer-1': NANNY },
    });
    await expect(
      svc.create('parent-1', 'h1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
    expect(expenseRepo.create).not.toHaveBeenCalled();
  });

  it('a HELPER may not create an expense', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({
      expenseRepo,
      members: { 'helper-1': HELPER },
    });
    await expect(
      svc.create('helper-1', 'h1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
    expect(expenseRepo.create).not.toHaveBeenCalled();
  });

  it('a non-member of the household is rejected', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: {} });
    await expect(
      svc.create('stranger', 'h1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
    expect(expenseRepo.create).not.toHaveBeenCalled();
  });
});

describe('ExpenseCommandService.create — currency must match the effective arrangement', () => {
  it('rejects a currency that does not match the effective arrangement', async () => {
    const expenseRepo = makeExpenseRepo();
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () => arrangement({ currency: 'EUR' })),
    });
    const svc = service({ expenseRepo, arrangementRepo });
    const err = await svc
      .create('carer-1', 'h1', expenseRequest({ currency: 'GBP' }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExpenseValidationError);
    expect((err as { metadata?: { reason?: string } }).metadata?.reason).toBe(
      'CURRENCY_MISMATCH'
    );
    expect(expenseRepo.create).not.toHaveBeenCalled();
  });

  it('rejects when the carer has no effective pay arrangement at all', async () => {
    const expenseRepo = makeExpenseRepo();
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () => null),
    });
    const svc = service({ expenseRepo, arrangementRepo });
    await expect(
      svc.create('carer-1', 'h1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseValidationError);
    expect(expenseRepo.create).not.toHaveBeenCalled();
  });

  it('accepts a matching currency', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo });
    await svc.create('carer-1', 'h1', expenseRequest({ currency: 'GBP' }));
    expect(expenseRepo.create).toHaveBeenCalledTimes(1);
  });
});

describe('ExpenseCommandService.create — mileage rows', () => {
  it('writes miles and leaves amount_minor null — never accepts a client-supplied amount', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo });
    // Cast past the wire union — the schema already forbids this shape, this
    // pins the server-side belt-and-braces the plan calls for.
    await svc.create('carer-1', 'h1', {
      ...mileageRequest(),
      amount_minor: 999_999,
    } as any);
    const written = expenseRepo.create.mock.calls[0][0];
    expect(written.miles).toBe(12.3);
    expect(written.amount_minor).toBeNull();
  });

  it('an expense row never writes miles', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo });
    await svc.create('carer-1', 'h1', expenseRequest());
    expect(expenseRepo.create.mock.calls[0][0].miles).toBeNull();
  });
});

describe('ExpenseCommandService.create — carer_display_name snapshot', () => {
  it("prefers the household member's display_name_override", async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({
      expenseRepo,
      members: {
        'carer-1': member('nanny', 'carer-1', { display_name_override: 'Nia' }),
      },
      userService: makeUserService('Antonia Rowe'),
    });
    await svc.create('carer-1', 'h1', expenseRequest());
    expect(expenseRepo.create.mock.calls[0][0].carer_display_name).toBe('Nia');
  });

  it('falls back to the unnamed-carer label when neither exists', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, userService: makeUserService(null) });
    await svc.create('carer-1', 'h1', expenseRequest());
    expect(expenseRepo.create.mock.calls[0][0].carer_display_name).toBe(
      'Carer'
    );
  });
});

// ---------------------------------------------------------------------------
// update / withdraw
// ---------------------------------------------------------------------------

describe('ExpenseCommandService.update', () => {
  it('the owning carer edits her own still-pending row', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo });
    const updated = await svc.update(
      'carer-1',
      'exp-1',
      expenseRequest({ description: 'Nappies (corrected)' })
    );
    expect(updated.description).toBe('Nappies (corrected)');
    expect(expenseRepo.updateOwnedPending).toHaveBeenCalledWith(
      'exp-1',
      'h1',
      'carer-1',
      expect.objectContaining({ description: 'Nappies (corrected)' })
    );
  });

  it('cannot edit a row belonging to another carer', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ carer_id: 'carer-2' })),
    });
    const svc = service({ expenseRepo });
    await expect(
      svc.update('carer-1', 'exp-1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
    expect(expenseRepo.updateOwnedPending).not.toHaveBeenCalled();
  });

  it('cannot edit a reviewed (approved) row', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ status: 'approved' })),
    });
    const svc = service({ expenseRepo });
    await expect(
      svc.update('carer-1', 'exp-1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotEditableError);
    expect(expenseRepo.updateOwnedPending).not.toHaveBeenCalled();
  });

  it('cannot edit a reviewed (rejected) row either', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ status: 'rejected' })),
    });
    const svc = service({ expenseRepo });
    await expect(
      svc.update('carer-1', 'exp-1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotEditableError);
  });

  it('a non-existent expense id 404s the same way as "not yours"', async () => {
    const expenseRepo = makeExpenseRepo({ findById: mock(async () => null) });
    const svc = service({ expenseRepo });
    await expect(
      svc.update('carer-1', 'nope', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
  });

  it('re-validates currency against the effective arrangement on edit too', async () => {
    const expenseRepo = makeExpenseRepo();
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () => arrangement({ currency: 'EUR' })),
    });
    const svc = service({ expenseRepo, arrangementRepo });
    await expect(
      svc.update('carer-1', 'exp-1', expenseRequest({ currency: 'GBP' }))
    ).rejects.toBeInstanceOf(ExpenseValidationError);
    expect(expenseRepo.updateOwnedPending).not.toHaveBeenCalled();
  });

  it('surfaces a lost race (flipped to reviewed between read and write) as not-editable', async () => {
    const expenseRepo = makeExpenseRepo({
      updateOwnedPending: mock(async () => null),
    });
    const svc = service({ expenseRepo });
    await expect(
      svc.update('carer-1', 'exp-1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotEditableError);
  });
});

describe('ExpenseCommandService.withdraw', () => {
  it('the owning carer withdraws (hard-deletes) her own pending row', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo });
    await svc.withdraw('carer-1', 'exp-1');
    expect(expenseRepo.deleteOwnedPending).toHaveBeenCalledWith(
      'exp-1',
      'h1',
      'carer-1'
    );
  });

  it('cannot withdraw another carer’s row', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ carer_id: 'carer-2' })),
    });
    const svc = service({ expenseRepo });
    await expect(svc.withdraw('carer-1', 'exp-1')).rejects.toBeInstanceOf(
      ExpenseNotFoundError
    );
    expect(expenseRepo.deleteOwnedPending).not.toHaveBeenCalled();
  });

  it('cannot withdraw a reviewed row', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ status: 'approved' })),
    });
    const svc = service({ expenseRepo });
    await expect(svc.withdraw('carer-1', 'exp-1')).rejects.toBeInstanceOf(
      ExpenseNotEditableError
    );
    expect(expenseRepo.deleteOwnedPending).not.toHaveBeenCalled();
  });

  it('surfaces a lost race as not-editable', async () => {
    const expenseRepo = makeExpenseRepo({
      deleteOwnedPending: mock(async () => false),
    });
    const svc = service({ expenseRepo });
    await expect(svc.withdraw('carer-1', 'exp-1')).rejects.toBeInstanceOf(
      ExpenseNotEditableError
    );
  });
});

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

describe('ExpenseCommandService.review — parent gate', () => {
  it('a parent may review', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({
      expenseRepo,
      members: { 'parent-1': PARENT, 'carer-1': NANNY },
    });
    await svc.review('parent-1', 'exp-1', {
      status: 'approved',
      review_note: undefined,
    });
    expect(expenseRepo.reviewPending).toHaveBeenCalledTimes(1);
  });

  it('an owner may review', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({
      expenseRepo,
      members: { 'owner-1': OWNER, 'carer-1': NANNY },
    });
    await svc.review('owner-1', 'exp-1', { status: 'rejected' });
    expect(expenseRepo.reviewPending).toHaveBeenCalledTimes(1);
  });

  it('the CARER cannot review her own expense', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'carer-1': NANNY } });
    await expect(
      svc.review('carer-1', 'exp-1', { status: 'approved' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(expenseRepo.reviewPending).not.toHaveBeenCalled();
  });

  it('a HELPER cannot review', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'helper-1': HELPER } });
    await expect(
      svc.review('helper-1', 'exp-1', { status: 'approved' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('a non-existent expense 404s before the role gate leaks anything', async () => {
    const expenseRepo = makeExpenseRepo({ findById: mock(async () => null) });
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await expect(
      svc.review('parent-1', 'nope', { status: 'approved' })
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
  });
});

describe('ExpenseCommandService.review — approving a plain expense row', () => {
  it('just flips status to approved, computing nothing', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({ kind: 'expense', amount_minor: 1200 })
      ),
    });
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await svc.review('parent-1', 'exp-1', {
      status: 'approved',
      review_note: 'Thanks',
    });
    const patch = expenseRepo.reviewPending.mock.calls[0][2];
    expect(patch.status).toBe('approved');
    expect(patch.reviewed_by).toBe('parent-1');
    expect(patch.review_note).toBe('Thanks');
    expect(patch).not.toHaveProperty('amount_minor');
  });

  it('rejecting requires nothing computed either', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ kind: 'expense' })),
    });
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await svc.review('parent-1', 'exp-1', { status: 'rejected' });
    const patch = expenseRepo.reviewPending.mock.calls[0][2];
    expect(patch.status).toBe('rejected');
    expect(patch).not.toHaveProperty('amount_minor');
    expect(patch.review_note).toBeNull();
  });

  it('cannot review an already-reviewed row', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ status: 'approved' })),
    });
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await expect(
      svc.review('parent-1', 'exp-1', { status: 'rejected' })
    ).rejects.toBeInstanceOf(ExpenseNotEditableError);
    expect(expenseRepo.reviewPending).not.toHaveBeenCalled();
  });

  it('surfaces a lost race as not-editable', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ kind: 'expense' })),
      reviewPending: mock(async () => null),
    });
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await expect(
      svc.review('parent-1', 'exp-1', { status: 'approved' })
    ).rejects.toBeInstanceOf(ExpenseNotEditableError);
  });
});

describe('ExpenseCommandService.review — approving MILEAGE freezes the computed amount', () => {
  it('prices miles x mileage_rate_per_mile_minor, half-up, in the SAME update', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({ kind: 'mileage', miles: 12.3, amount_minor: null })
      ),
    });
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () =>
        arrangement({ mileage_rate_per_mile_minor: 45 })
      ),
    });
    const svc = service({
      expenseRepo,
      arrangementRepo,
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });
    const patch = expenseRepo.reviewPending.mock.calls[0][2];
    // 12.3 miles x 45p = 553.5p, rounded normally (not the boundary case).
    expect(patch.amount_minor).toBe(554);
    expect(patch.status).toBe('approved');
  });

  it('HALF-UP BOUNDARY: 1.1 miles x 45p/mile = exactly 49.5p, rounds UP to 50p', async () => {
    // The pinned boundary case: milesTenths=11, rate=45 -> 11*45=495 exact,
    // and 495/10 = 49.5 exactly on the half — half-up must round to 50, not 49.
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({ kind: 'mileage', miles: 1.1, amount_minor: null })
      ),
    });
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () =>
        arrangement({ mileage_rate_per_mile_minor: 45 })
      ),
    });
    const svc = service({
      expenseRepo,
      arrangementRepo,
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });
    const patch = expenseRepo.reviewPending.mock.calls[0][2];
    expect(patch.amount_minor).toBe(50);
  });

  it('refuses to approve with NO mileage rate on the arrangement — never a zero amount', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({ kind: 'mileage', miles: 12.3, amount_minor: null })
      ),
    });
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () =>
        arrangement({ mileage_rate_per_mile_minor: null })
      ),
    });
    const svc = service({
      expenseRepo,
      arrangementRepo,
      members: { 'parent-1': PARENT },
    });
    const err = await svc
      .review('parent-1', 'exp-1', { status: 'approved' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExpenseValidationError);
    expect((err as { metadata?: { reason?: string } }).metadata?.reason).toBe(
      'NO_MILEAGE_RATE'
    );
    expect(expenseRepo.reviewPending).not.toHaveBeenCalled();
  });

  it('refuses to approve mileage with NO effective arrangement at all', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({ kind: 'mileage', miles: 12.3, amount_minor: null })
      ),
    });
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () => null),
    });
    const svc = service({
      expenseRepo,
      arrangementRepo,
      members: { 'parent-1': PARENT },
    });
    await expect(
      svc.review('parent-1', 'exp-1', { status: 'approved' })
    ).rejects.toBeInstanceOf(ExpenseValidationError);
    expect(expenseRepo.reviewPending).not.toHaveBeenCalled();
  });

  it('rejecting a mileage row computes nothing and needs no rate at all', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({ kind: 'mileage', miles: 12.3, amount_minor: null })
      ),
    });
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () => null),
    });
    const svc = service({
      expenseRepo,
      arrangementRepo,
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'rejected' });
    const patch = expenseRepo.reviewPending.mock.calls[0][2];
    expect(patch.status).toBe('rejected');
    expect(patch).not.toHaveProperty('amount_minor');
    expect(arrangementRepo.effectiveOn).not.toHaveBeenCalled();
  });
});

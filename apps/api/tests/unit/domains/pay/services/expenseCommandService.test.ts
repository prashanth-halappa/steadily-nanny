import { describe, expect, it, mock } from 'bun:test';
import {
  ExpenseNotEditableError,
  ExpenseNotFoundError,
  ExpenseValidationError,
  ExpenseWeekLockedError,
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
    // Since 051 the review write is the `review_pending_expense` RPC, so the
    // repository answers with an OUTCOME rather than a row-or-null: the week
    // freeze is now evaluated inside the write and has to be distinguishable
    // from a plain lost status race (F-B4-1).
    reviewPending: mock(
      async (_id: string, _h: string, patch: Record<string, unknown>) => ({
        outcome: 'reviewed',
        expense: { ...expenseRow(), ...patch },
      })
    ),
    ...overrides,
  };
}

/** The repository outcome for "the week froze under this write". */
function weekLockedOutcome(overrides: Record<string, unknown> = {}) {
  return {
    outcome: 'week_locked',
    weekStart: '2026-08-03',
    timesheetStatus: 'approved',
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

/**
 * The week-lock lookup (Phase 3/4 review, SERIOUS 6). Defaults to "no
 * timesheet for that week yet", which is the common case and unlocked.
 */
function makeTimesheetRepo(
  row: Record<string, unknown> | null = null,
  overrides: Record<string, unknown> = {}
): any {
  return {
    findByWeek: mock(async () => row),
    ...overrides,
  };
}

function timesheetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ts-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    week_start: '2026-08-03',
    status: 'submitted',
    ...overrides,
  };
}

interface ServiceParts {
  members?: Record<string, unknown>;
  expenseRepo?: any;
  arrangementRepo?: any;
  userService?: any;
  timesheetRepo?: any;
}

function service(parts: ServiceParts = {}): any {
  return new ExpenseCommandService(
    parts.expenseRepo ?? makeExpenseRepo(),
    parts.arrangementRepo ?? makeArrangementRepo(),
    makeMemberRepo(parts.members ?? { 'carer-1': NANNY }),
    parts.userService ?? makeUserService(),
    parts.timesheetRepo ?? makeTimesheetRepo()
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

  // Phase 3/4 review, MINOR 9: review answered 404 for "missing" but 403 for
  // "exists, just not yours", which is the enumeration leak the house collapse
  // rule exists to close — and which `loadOwnedPending` already follows.
  it('the CARER cannot review her own expense — collapsed into the SAME 404 as "no such expense"', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'carer-1': NANNY } });
    await expect(
      svc.review('carer-1', 'exp-1', { status: 'approved' })
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
    expect(expenseRepo.reviewPending).not.toHaveBeenCalled();
  });

  it('a HELPER cannot review', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'helper-1': HELPER } });
    await expect(
      svc.review('helper-1', 'exp-1', { status: 'approved' })
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
  });

  it('a non-member reviewing another household’s expense is refused', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: {} });
    await expect(
      svc.review('stranger', 'exp-1', { status: 'approved' })
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
  });

  it('a non-existent expense 404s before the role gate leaks anything', async () => {
    const expenseRepo = makeExpenseRepo({ findById: mock(async () => null) });
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await expect(
      svc.review('parent-1', 'nope', { status: 'approved' })
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
  });

  it('MISSING and NOT-YOURS are indistinguishable — same error, same message', async () => {
    const missing = service({
      expenseRepo: makeExpenseRepo({ findById: mock(async () => null) }),
      members: { 'parent-1': PARENT },
    })
      .review('parent-1', 'exp-1', { status: 'approved' })
      .catch((err: unknown) => err);
    const notYours = service({ members: {} })
      .review('stranger', 'exp-1', { status: 'approved' })
      .catch((err: unknown) => err);
    const [a, b] = await Promise.all([missing, notYours]);
    expect(a).toBeInstanceOf(ExpenseNotFoundError);
    expect(b).toBeInstanceOf(ExpenseNotFoundError);
    expect((a as Error).message).toBe((b as Error).message);
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
      reviewPending: mock(async () => ({ outcome: 'not_pending' })),
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

// ---------------------------------------------------------------------------
// review — the arrangement's CURRENCY is re-asserted before mileage is priced
// (Phase 3/4 review, SERIOUS 5). `create` asserts the claim's currency
// against the effective arrangement, but `review` priced with
// `effectiveOn(local_date)` and never re-checked it. A same-day corrective
// arrangement — the documented tie-break mechanism (docs/11-MONEY.md §2) — in
// a different currency froze, say, a USD-rate amount onto a row labelled GBP.
// ---------------------------------------------------------------------------

describe('ExpenseCommandService.review — mileage approval re-asserts currency', () => {
  it('refuses to price a GBP mileage row against a USD arrangement', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({
          kind: 'mileage',
          miles: 10,
          amount_minor: null,
          currency: 'GBP',
        })
      ),
    });
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () =>
        arrangement({ currency: 'USD', mileage_rate_per_mile_minor: 67 })
      ),
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

  it('reports the mismatch as CURRENCY_MISMATCH, naming both codes', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({
          kind: 'mileage',
          miles: 10,
          amount_minor: null,
          currency: 'GBP',
        })
      ),
    });
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () =>
        arrangement({ currency: 'USD', mileage_rate_per_mile_minor: 67 })
      ),
    });
    const svc = service({
      expenseRepo,
      arrangementRepo,
      members: { 'parent-1': PARENT },
    });

    const err = await svc
      .review('parent-1', 'exp-1', { status: 'approved' })
      .catch((error: unknown) => error);
    expect(
      (err as { metadata?: Record<string, unknown> }).metadata
    ).toMatchObject({
      reason: 'CURRENCY_MISMATCH',
      expectedCurrency: 'USD',
      submittedCurrency: 'GBP',
    });
  });

  it('a matching currency still prices and freezes as before', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({
          kind: 'mileage',
          miles: 10,
          amount_minor: null,
          currency: 'GBP',
        })
      ),
    });
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });
    expect(expenseRepo.reviewPending.mock.calls[0][2].amount_minor).toBe(450);
  });

  it('REJECTING a mileage row never re-asserts currency — nothing is being priced', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () =>
        expenseRow({ kind: 'mileage', miles: 10, amount_minor: null })
      ),
    });
    const arrangementRepo = makeArrangementRepo({
      effectiveOn: mock(async () => arrangement({ currency: 'USD' })),
    });
    const svc = service({
      expenseRepo,
      arrangementRepo,
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'rejected' });
    expect(expenseRepo.reviewPending).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// review — approving into an APPROVED (frozen) week is refused
// (Phase 3/4 review, SERIOUS 6). The week's `earnings` snapshot froze at
// approval and is never recomputed (docs/11-MONEY.md §3), so an expense
// approved afterwards is money that exists on the row and appears on NO
// statement. Blocking is visible; stranding is silent.
// ---------------------------------------------------------------------------

describe('ExpenseCommandService.review — an approved week is locked', () => {
  it('refuses to APPROVE a claim dated inside an already-approved week', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ local_date: '2026-08-04' })),
    });
    const timesheetRepo = makeTimesheetRepo(
      timesheetRow({ status: 'approved' })
    );
    const svc = service({
      expenseRepo,
      timesheetRepo,
      members: { 'parent-1': PARENT },
    });

    await expect(
      svc.review('parent-1', 'exp-1', { status: 'approved' })
    ).rejects.toBeInstanceOf(ExpenseWeekLockedError);
    expect(expenseRepo.reviewPending).not.toHaveBeenCalled();
  });

  it('looks the week up by the CLAIM’s local date, Monday-anchored', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ local_date: '2026-08-09' })), // Sunday
    });
    const timesheetRepo = makeTimesheetRepo();
    const svc = service({
      expenseRepo,
      timesheetRepo,
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });
    expect(timesheetRepo.findByWeek).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-03'
    );
  });

  it('carries the week and status in the error so the client can say WHICH week', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ local_date: '2026-08-04' })),
    });
    const svc = service({
      expenseRepo,
      timesheetRepo: makeTimesheetRepo(timesheetRow({ status: 'approved' })),
      members: { 'parent-1': PARENT },
    });
    const err = await svc
      .review('parent-1', 'exp-1', { status: 'approved' })
      .catch((error: unknown) => error);
    expect((err as { statusCode?: number }).statusCode).toBe(409);
    expect((err as { code?: string }).code).toBe('CONFLICT');
    expect(
      (err as { metadata?: Record<string, unknown> }).metadata
    ).toMatchObject({
      reason: 'EXPENSE_WEEK_LOCKED',
      weekStart: '2026-08-03',
      timesheetStatus: 'approved',
    });
  });

  it('REJECTING into an approved week is still allowed — it moves no money', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ local_date: '2026-08-04' })),
    });
    const svc = service({
      expenseRepo,
      timesheetRepo: makeTimesheetRepo(timesheetRow({ status: 'approved' })),
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'rejected' });
    expect(expenseRepo.reviewPending).toHaveBeenCalledTimes(1);
  });

  it('a submitted (still open) week approves normally', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({
      expenseRepo,
      timesheetRepo: makeTimesheetRepo(timesheetRow({ status: 'submitted' })),
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });
    expect(expenseRepo.reviewPending).toHaveBeenCalledTimes(1);
  });

  it('no timesheet for that week at all approves normally', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({
      expenseRepo,
      timesheetRepo: makeTimesheetRepo(null),
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });
    expect(expenseRepo.reviewPending).toHaveBeenCalledTimes(1);
  });

  it('a departed carer (carer_id null) has no week to strand money in — no lookup, no block', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ carer_id: null })),
    });
    const timesheetRepo = makeTimesheetRepo(
      timesheetRow({ status: 'approved' })
    );
    const svc = service({
      expenseRepo,
      timesheetRepo,
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });
    expect(timesheetRepo.findByWeek).not.toHaveBeenCalled();
    expect(expenseRepo.reviewPending).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// F-B4-1 — the freeze pre-check cannot see the race it guards.
//
// `assertWeekNotFrozen` is a plain READ; the write it guards used to be a CAS
// on `status = 'pending'` alone. Between the two, a timesheet approve can
// compute its earnings snapshot (pulling approved expenses), commit
// `approved`, and freeze — and this expense's CAS still matches `pending` and
// still commits `approved`. The result is a reimbursement that is owed, sits
// on a row, and appears on NO statement (`docs/11-MONEY.md` §3: approved weeks
// never recompute). So the not-frozen condition has to travel INTO the guarded
// write, which is what the week lock argument is.
// ---------------------------------------------------------------------------

describe('ExpenseCommandService.review — the week freeze travels into the write', () => {
  it('hands the write the carer and week so the guard can be evaluated there', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ local_date: '2026-08-04' })),
    });
    const svc = service({
      expenseRepo,
      timesheetRepo: makeTimesheetRepo(timesheetRow({ status: 'submitted' })),
      members: { 'parent-1': PARENT },
    });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });
    expect(expenseRepo.reviewPending.mock.calls[0][3]).toEqual({
      carerId: 'carer-1',
      weekStart: '2026-08-03',
    });
  });

  it('THE RACE: the pre-check reads "submitted", the write reports the week froze', async () => {
    // Exactly the interleaving: read submitted -> timesheet approve commits
    // with a frozen earnings snapshot -> this write arrives. Before the guard
    // moved into the write, this approved anyway.
    const timesheetRepo = makeTimesheetRepo(
      timesheetRow({ status: 'submitted' })
    );
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ local_date: '2026-08-04' })),
      reviewPending: mock(async () => weekLockedOutcome()),
    });
    const svc = service({
      expenseRepo,
      timesheetRepo,
      members: { 'parent-1': PARENT },
    });

    const err = await svc
      .review('parent-1', 'exp-1', { status: 'approved' })
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(ExpenseWeekLockedError);
    expect(
      (err as { metadata?: Record<string, unknown> }).metadata
    ).toMatchObject({
      reason: 'EXPENSE_WEEK_LOCKED',
      weekStart: '2026-08-03',
      timesheetStatus: 'approved',
    });
  });

  it('a lost STATUS race is still the not-editable error, not the week error', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow()),
      reviewPending: mock(async () => ({ outcome: 'not_pending' })),
    });
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await expect(
      svc.review('parent-1', 'exp-1', { status: 'approved' })
    ).rejects.toBeInstanceOf(ExpenseNotEditableError);
  });

  it('a REJECTION passes NO week lock — it moves no money into the week', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await svc.review('parent-1', 'exp-1', { status: 'rejected' });
    expect(expenseRepo.reviewPending.mock.calls[0][3]).toBeNull();
  });

  it('a carer-less row passes NO week lock — there is no week to freeze', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ carer_id: null })),
    });
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await svc.review('parent-1', 'exp-1', { status: 'approved' });
    expect(expenseRepo.reviewPending.mock.calls[0][3]).toBeNull();
  });

  it('THE UNCONTESTED PATH COSTS NOTHING: one write, one row back, no retry', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    const reviewed = await svc.review('parent-1', 'exp-1', {
      status: 'approved',
    });
    expect(expenseRepo.reviewPending).toHaveBeenCalledTimes(1);
    expect(reviewed.status).toBe('approved');
    expect(reviewed.id).toBe('exp-1');
  });
});

// ---------------------------------------------------------------------------
// F-B3b-3 (expense half) — a REMOVED nanny could still mutate her pending
// claims. `loadOwnedPending` checked `carer_id === callerId` and the status,
// and never asked whether the caller is still an ACTIVE member — while
// `create` (via `assertActiveNanny`) always has. Membership is checked BEFORE
// the status check and collapses into the SAME 404 as "not yours", so a
// removed member learns neither that the row exists nor what state it is in.
// ---------------------------------------------------------------------------

describe('ExpenseCommandService — a removed carer may not mutate her old claims', () => {
  it('a REMOVED nanny cannot edit her own still-pending claim', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: {} });
    await expect(
      svc.update('carer-1', 'exp-1', expenseRequest({ amount_minor: 999_999 }))
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
    expect(expenseRepo.updateOwnedPending).not.toHaveBeenCalled();
  });

  it('a REMOVED nanny cannot withdraw her own still-pending claim', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: {} });
    await expect(svc.withdraw('carer-1', 'exp-1')).rejects.toBeInstanceOf(
      ExpenseNotFoundError
    );
    expect(expenseRepo.deleteOwnedPending).not.toHaveBeenCalled();
  });

  it('a member demoted away from nanny cannot edit either', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({
      expenseRepo,
      members: { 'carer-1': member('helper', 'carer-1') },
    });
    await expect(
      svc.update('carer-1', 'exp-1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
    expect(expenseRepo.updateOwnedPending).not.toHaveBeenCalled();
  });

  it('REMOVED is indistinguishable from NOT-YOURS — same error, same message', async () => {
    const removed = service({ members: {} })
      .update('carer-1', 'exp-1', expenseRequest())
      .catch((err: unknown) => err);
    const notYours = service({
      expenseRepo: makeExpenseRepo({
        findById: mock(async () => expenseRow({ carer_id: 'carer-2' })),
      }),
    })
      .update('carer-1', 'exp-1', expenseRequest())
      .catch((err: unknown) => err);
    const [a, b] = await Promise.all([removed, notYours]);
    expect(a).toBeInstanceOf(ExpenseNotFoundError);
    expect(b).toBeInstanceOf(ExpenseNotFoundError);
    expect((a as Error).message).toBe((b as Error).message);
  });

  it('membership is checked BEFORE status — a removed carer learns no review state', async () => {
    const expenseRepo = makeExpenseRepo({
      findById: mock(async () => expenseRow({ status: 'approved' })),
    });
    const svc = service({ expenseRepo, members: {} });
    await expect(
      svc.update('carer-1', 'exp-1', expenseRequest())
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
  });

  it('the ACTIVE nanny is unaffected — she still edits her own pending row', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'carer-1': NANNY } });
    await svc.update('carer-1', 'exp-1', expenseRequest());
    expect(expenseRepo.updateOwnedPending).toHaveBeenCalledTimes(1);
  });
});

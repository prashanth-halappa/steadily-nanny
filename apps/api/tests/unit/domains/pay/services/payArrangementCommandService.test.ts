import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';
import {
  PayArrangementNotFoundError,
  PayArrangementValidationError,
} from '../../../../../src/domains/pay/errors/payErrors';
import { PayArrangementCommandService } from '../../../../../src/domains/pay/services/payArrangementCommandService';
import type { CreatePayArrangementRequest } from '../../../../../src/domains/pay/types';

const createdRow = {
  id: 'pa-new',
  household_id: 'h1',
  carer_id: 'carer-1',
  rate_minor: 1500,
  bill_rate_minor: null,
  currency: 'GBP',
  overtime_threshold_minutes: null,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: null,
  valid_from: '2026-08-04',
  carer_display_name: 'Nia Rowe',
  note: null,
  created_by: 'parent-1',
  created_at: '2026-08-04T09:00:00.000Z',
};

/** The zod-validated body, with the schema's defaults already applied. */
function request(
  overrides: Partial<CreatePayArrangementRequest> = {}
): CreatePayArrangementRequest {
  return {
    rate_minor: 1500,
    currency: 'GBP',
    overtime_multiplier: 1.5,
    valid_from: '2026-08-04',
    ...overrides,
  };
}

function makePayRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...createdRow,
      ...data,
    })),
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

/** Membership lookup keyed by user id — caller and carer resolve separately. */
function makeMemberRepo(byUserId: Record<string, unknown>): any {
  return {
    findActiveMembership: mock(
      async (_householdId: string, userId: string) => byUserId[userId] ?? null
    ),
  };
}

function makeHouseholdRepo(timezone = 'Europe/London', currency = 'GBP'): any {
  return { findById: mock(async () => ({ id: 'h1', timezone, currency })) };
}

function makeUserService(name: string | null = 'Nia Rowe'): any {
  return {
    getProfileById: mock(async () => (name === null ? null : { name })),
  };
}

const PARENT = member('parent', 'parent-1');
const CO_PARENT = member('parent', 'parent-2');
const OWNER = member('owner', 'owner-1');
const NANNY = member('nanny', 'carer-1');
const HELPER = member('helper', 'helper-1');

function makePush(overrides: Record<string, unknown> = {}): any {
  return {
    notifyUser: mock(() => {}),
    ...overrides,
  };
}

interface ServiceParts {
  members?: Record<string, unknown>;
  payRepo?: any;
  timezone?: string;
  householdCurrency?: string;
  userService?: any;
  push?: any;
}

function service(parts: ServiceParts = {}): any {
  return new PayArrangementCommandService(
    parts.payRepo ?? makePayRepo(),
    makeMemberRepo(parts.members ?? { 'parent-1': PARENT, 'carer-1': NANNY }),
    makeHouseholdRepo(
      parts.timezone ?? 'Europe/London',
      parts.householdCurrency ?? 'GBP'
    ),
    parts.userService ?? makeUserService(),
    parts.push ?? makePush()
  );
}

/** Fixed clock: 2026-08-04 10:00 UTC — a plain mid-morning in London. */
const NOW = () => new Date('2026-08-04T10:00:00.000Z');

describe('PayArrangementCommandService.create — parent gate', () => {
  it('a parent may set pay terms (single parent suffices — no co-parent approval)', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    const created = await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request(),
      NOW
    );
    expect(created.id).toBe('pa-new');
    expect(payRepo.create).toHaveBeenCalledTimes(1);
  });

  it('a co-parent may set them independently (owner decision 1)', async () => {
    const payRepo = makePayRepo();
    const svc = service({
      payRepo,
      members: { 'parent-2': CO_PARENT, 'carer-1': NANNY },
    });
    await svc.create('parent-2', 'h1', 'carer-1', request(), NOW);
    expect(payRepo.create).toHaveBeenCalledTimes(1);
  });

  it('the owner may set them', async () => {
    const payRepo = makePayRepo();
    const svc = service({
      payRepo,
      members: { 'owner-1': OWNER, 'carer-1': NANNY },
    });
    await svc.create('owner-1', 'h1', 'carer-1', request(), NOW);
    expect(payRepo.create).toHaveBeenCalledTimes(1);
  });

  it('the NANNY may not set her own pay', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo, members: { 'carer-1': NANNY } });
    await expect(
      svc.create('carer-1', 'h1', 'carer-1', request(), NOW)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(payRepo.create).not.toHaveBeenCalled();
  });

  it('a HELPER may not set anyone’s pay', async () => {
    const payRepo = makePayRepo();
    const svc = service({
      payRepo,
      members: { 'helper-1': HELPER, 'carer-1': NANNY },
    });
    await expect(
      svc.create('helper-1', 'h1', 'carer-1', request(), NOW)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(payRepo.create).not.toHaveBeenCalled();
  });

  it('a non-member may not', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo, members: { 'carer-1': NANNY } });
    await expect(
      svc.create('stranger', 'h1', 'carer-1', request(), NOW)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(payRepo.create).not.toHaveBeenCalled();
  });
});

describe('PayArrangementCommandService.create — D12-class carer assertion', () => {
  it('rejects a carer_id that is not a member of this household', async () => {
    // The D12 shape: a client-supplied foreign id used on a write. The repo
    // runs as the service role and bypasses RLS, so this check is the gate.
    const payRepo = makePayRepo();
    const svc = service({ payRepo, members: { 'parent-1': PARENT } });
    await expect(
      svc.create('parent-1', 'h1', 'carer-elsewhere', request(), NOW)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
    expect(payRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a member who is not a nanny (a helper cannot be paid a rate)', async () => {
    const payRepo = makePayRepo();
    const svc = service({
      payRepo,
      members: { 'parent-1': PARENT, 'helper-1': HELPER },
    });
    await expect(
      svc.create('parent-1', 'h1', 'helper-1', request(), NOW)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
    expect(payRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a co-parent as the carer', async () => {
    const svc = service({
      members: { 'parent-1': PARENT, 'parent-2': CO_PARENT },
    });
    await expect(
      svc.create('parent-1', 'h1', 'parent-2', request(), NOW)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('uses the SAME error for a carer of ANOTHER household as for a missing one', async () => {
    // findActiveMembership is scoped to (household, user), so a real nanny of
    // household h2 simply has no row here — and must be indistinguishable
    // from a uuid that names nobody, or the endpoint enumerates carers.
    const svc = service({ members: { 'parent-1': PARENT } });
    const otherHouseholdCarer = svc
      .create('parent-1', 'h1', 'carer-of-h2', request(), NOW)
      .catch((err: unknown) => err);
    const nobody = svc
      .create('parent-1', 'h1', 'nobody-at-all', request(), NOW)
      .catch((err: unknown) => err);
    const [a, b] = await Promise.all([otherHouseholdCarer, nobody]);
    expect(a).toBeInstanceOf(PayArrangementNotFoundError);
    expect(b).toBeInstanceOf(PayArrangementNotFoundError);
    expect((a as Error).message).toBe((b as Error).message);
  });

  it('rejects a carer whose membership is no longer active', async () => {
    // findActiveMembership returns only `status = 'active'` rows, so a
    // departed nanny reads as absent — and no new terms can be written
    // against her (docs/11-MONEY.md §4's departed-carer arm depends on this).
    const svc = service({ members: { 'parent-1': PARENT } });
    await expect(
      svc.create('parent-1', 'h1', 'carer-1', request(), NOW)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });
});

describe('PayArrangementCommandService.create — valid_from is household-local', () => {
  it('accepts today in a household EAST of UTC that has already rolled over', async () => {
    // 23:30Z is 11:30 on 2026-08-05 in Auckland. A server-UTC "today" check
    // would reject this legitimate morning entry (review finding 11).
    const payRepo = makePayRepo();
    const svc = service({ payRepo, timezone: 'Pacific/Auckland' });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ valid_from: '2026-08-05' }),
      () => new Date('2026-08-04T23:30:00.000Z')
    );
    expect(payRepo.create).toHaveBeenCalledTimes(1);
  });

  it('rejects tomorrow in that same household', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo, timezone: 'Pacific/Auckland' });
    await expect(
      svc.create(
        'parent-1',
        'h1',
        'carer-1',
        request({ valid_from: '2026-08-06' }),
        () => new Date('2026-08-04T23:30:00.000Z')
      )
    ).rejects.toBeInstanceOf(PayArrangementValidationError);
    expect(payRepo.create).not.toHaveBeenCalled();
  });

  it('accepts today in a BST household whose local date is ahead of UTC', async () => {
    // Europe/London is UTC+1 in August: 23:30Z is 00:30 on 2026-08-05 locally.
    const payRepo = makePayRepo();
    const svc = service({ payRepo, timezone: 'Europe/London' });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ valid_from: '2026-08-05' }),
      () => new Date('2026-08-04T23:30:00.000Z')
    );
    expect(payRepo.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a date the SERVER already calls today but the household does not', async () => {
    // The mirror-image bug: 04:30Z on 2026-08-05 is still 2026-08-04 in Los
    // Angeles, so "2026-08-05" is genuinely tomorrow for this family.
    const payRepo = makePayRepo();
    const svc = service({ payRepo, timezone: 'America/Los_Angeles' });
    await expect(
      svc.create(
        'parent-1',
        'h1',
        'carer-1',
        request({ valid_from: '2026-08-05' }),
        () => new Date('2026-08-05T04:30:00.000Z')
      )
    ).rejects.toBeInstanceOf(PayArrangementValidationError);
    expect(payRepo.create).not.toHaveBeenCalled();
  });

  it('allows backdating — an open week recomputes, an approved week stays frozen', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ valid_from: '2025-01-01' }),
      NOW
    );
    expect(payRepo.create).toHaveBeenCalledTimes(1);
  });

  it('names the reason so the client can branch on it', async () => {
    const svc = service();
    const err = await svc
      .create(
        'parent-1',
        'h1',
        'carer-1',
        request({ valid_from: '2026-08-05' }),
        NOW
      )
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(PayArrangementValidationError);
    expect((err as { metadata?: { reason?: string } }).metadata?.reason).toBe(
      'VALID_FROM_IN_FUTURE'
    );
  });
});

describe('PayArrangementCommandService.create — currency resolution (T4)', () => {
  it('resolves an absent request currency from the household row', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo, householdCurrency: 'USD' });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ currency: undefined }),
      NOW
    );
    expect(payRepo.create.mock.calls[0][0].currency).toBe('USD');
  });

  it('an explicit request currency still wins over the household default', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo, householdCurrency: 'USD' });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ currency: 'EUR' }),
      NOW
    );
    expect(payRepo.create.mock.calls[0][0].currency).toBe('EUR');
  });
});

describe('PayArrangementCommandService.create — carer_display_name derivation', () => {
  it("prefers the household member's display_name_override", async () => {
    const payRepo = makePayRepo();
    const svc = service({
      payRepo,
      members: {
        'parent-1': PARENT,
        'carer-1': member('nanny', 'carer-1', {
          display_name_override: 'Nia',
        }),
      },
      userService: makeUserService('Antonia Rowe'),
    });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    expect(payRepo.create.mock.calls[0][0].carer_display_name).toBe('Nia');
  });

  it("falls back to the carer's profile name when there is no override", async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo, userService: makeUserService('Nia Rowe') });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    expect(payRepo.create.mock.calls[0][0].carer_display_name).toBe('Nia Rowe');
  });

  it('treats a whitespace-only override as absent', async () => {
    const payRepo = makePayRepo();
    const svc = service({
      payRepo,
      members: {
        'parent-1': PARENT,
        'carer-1': member('nanny', 'carer-1', { display_name_override: '  ' }),
      },
      userService: makeUserService('Nia Rowe'),
    });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    expect(payRepo.create.mock.calls[0][0].carer_display_name).toBe('Nia Rowe');
  });

  it('falls back to the unnamed-carer label when neither exists', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo, userService: makeUserService(null) });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    expect(payRepo.create.mock.calls[0][0].carer_display_name).toBe('Carer');
  });

  it('never accepts a client-supplied display name', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      {
        ...request(),
        // Not part of the wire schema; belt-and-braces that a stray field
        // cannot reach the row (the snapshot is evidence, not client input).
        carer_display_name: 'Someone Else',
      } as CreatePayArrangementRequest,
      NOW
    );
    expect(payRepo.create.mock.calls[0][0].carer_display_name).toBe('Nia Rowe');
  });
});

describe('PayArrangementCommandService.create — the written row', () => {
  it('writes the full term set with route ids and the caller as created_by', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({
        rate_minor: 1725,
        currency: 'GBP',
        overtime_threshold_minutes: 2400,
        overtime_multiplier: 1.25,
        guaranteed_minutes_per_week: 1800,
        pto_entitlement_minutes_per_year: 16800,
        mileage_rate_per_mile_minor: 45,
        cancellation_paid_within_hours: 24,
        valid_from: '2026-08-04',
        note: 'annual review',
      }),
      NOW
    );
    expect(payRepo.create.mock.calls[0][0]).toEqual({
      household_id: 'h1',
      carer_id: 'carer-1',
      rate_minor: 1725,
      currency: 'GBP',
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.25,
      guaranteed_minutes_per_week: 1800,
      pto_entitlement_minutes_per_year: 16800,
      mileage_rate_per_mile_minor: 45,
      cancellation_paid_within_hours: 24,
      valid_from: '2026-08-04',
      carer_display_name: 'Nia Rowe',
      note: 'annual review',
      created_by: 'parent-1',
      terms: {},
    });
  });

  // T9 storage (1-D): the exact "forgotten field silently never persists"
  // trap the field-by-field insert literal invites (T17) — pin both arms.
  it('passes a supplied terms object through to the repo create call verbatim', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    const terms = { notice_period_days: 14, driving_required: true };
    await svc.create('parent-1', 'h1', 'carer-1', request({ terms }), NOW);
    expect(payRepo.create.mock.calls[0][0].terms).toEqual(terms);
  });

  it('writes an empty terms object when none is supplied', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    expect(payRepo.create.mock.calls[0][0].terms).toEqual({});
  });

  it('stores omitted optional terms as explicit nulls, not undefined', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    const written = payRepo.create.mock.calls[0][0];
    expect(written.overtime_threshold_minutes).toBeNull();
    expect(written.guaranteed_minutes_per_week).toBeNull();
    expect(written.pto_entitlement_minutes_per_year).toBeNull();
    // NULL here means "no cancellation pay" — a real setting, not "unset".
    expect(written.cancellation_paid_within_hours).toBeNull();
    expect(written.mileage_rate_per_mile_minor).toBeNull();
    expect(written.note).toBeNull();
  });

  it('never writes bill_rate_minor — dormant until Tier 2 invoicing', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    expect(payRepo.create.mock.calls[0][0]).not.toHaveProperty(
      'bill_rate_minor'
    );
  });

  it('returns the created arrangement', async () => {
    const svc = service();
    const created = await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request(),
      NOW
    );
    expect(created.id).toBe('pa-new');
    expect(created.rate_minor).toBe(1500);
  });
});

describe('PayArrangementCommandService.create — notifies the carer', () => {
  it('notifies the CARER, not the parent who set the terms, after a successful create', async () => {
    const push = makePush();
    const svc = service({ push });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);

    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    const [recipientId, payload] = push.notifyUser.mock.calls[0];
    expect(recipientId).toBe('carer-1');
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET,
      householdId: 'h1',
    });
    expect(typeof payload.title).toBe('string');
    expect(typeof payload.body).toBe('string');
  });

  it('never notifies the calling parent or the household at large', async () => {
    const push = makePush();
    const svc = service({ push });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);

    const recipients = push.notifyUser.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(recipients).toEqual(['carer-1']);
  });

  it('does not notify when the write itself fails (role gate)', async () => {
    const push = makePush();
    const svc = service({
      push,
      members: { 'helper-1': HELPER, 'carer-1': NANNY },
    });
    await expect(
      svc.create('helper-1', 'h1', 'carer-1', request(), NOW)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(push.notifyUser).not.toHaveBeenCalled();
  });

  it('fire-and-forget: create still succeeds when the push throws', async () => {
    const push = makePush({
      notifyUser: mock(() => {
        throw new Error('expo is down');
      }),
    });
    const svc = service({ push });
    const created = await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request(),
      NOW
    );
    expect(created.id).toBe('pa-new');
    expect(push.notifyUser).toHaveBeenCalledTimes(1);
  });
});

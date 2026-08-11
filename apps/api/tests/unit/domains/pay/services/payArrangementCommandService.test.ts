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

const PREVIOUS_ARRANGEMENT = {
  id: 'pa-previous',
  household_id: 'h1',
  carer_id: 'carer-1',
  rate_minor: 2000,
  currency: 'GBP',
  overtime_multiplier: 1.5,
  valid_from: '2026-01-01',
  valid_to: null,
  created_at: '2026-01-01T09:00:00.000Z',
};

function makePayRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...createdRow,
      ...data,
    })),
    listForCarer: mock(async () => [PREVIOUS_ARRANGEMENT]),
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

function makeTimesheetRepo(rows: any[] = []): any {
  return { listForHousehold: mock(async () => rows) };
}

function makeWeekEarnings(
  answers: Record<string, { status: string; gross_minor?: number }> = {}
): any {
  return {
    computeForWeekWithArrangements: mock(
      async (
        _h: string,
        _c: string,
        weekStart: string,
        arrangements: any[]
      ) => {
        // Test doubles key their canned answer on (weekStart, whether the
        // NEW arrangement id is present in the supplied history) so a single
        // fixture can express "prices lower under the new terms".
        const isAfter = arrangements.some((a: any) => a.id === 'pa-new');
        const key = `${weekStart}:${isAfter ? 'after' : 'before'}`;
        return answers[key] ?? { status: 'ok', gross_minor: 1_000_00 };
      }
    ),
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
  timesheetRepo?: any;
  weekEarnings?: any;
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
    parts.push ?? makePush(),
    parts.timesheetRepo ?? makeTimesheetRepo(),
    parts.weekEarnings ?? makeWeekEarnings()
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

describe('PayArrangementCommandService.create — valid_from, household-local (D-16)', () => {
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

  // D-16 reverses the old no-future-dating rule: a scheduled raise is now
  // the normal case, not the edge case. `screens-pay-terms.md` §6.
  it('accepts a scheduled future date — the T12 cut is reversed', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ valid_from: '2026-09-01' }),
      NOW
    );
    expect(payRepo.create).toHaveBeenCalledTimes(1);
    expect(payRepo.create.mock.calls[0][0].valid_from).toBe('2026-09-01');
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

  // The T12 cut is reversed, but v1's OTHER guardrail — a bound, opposite
  // direction — replaces it: "a future-date bound replaces the future-date
  // refusal" (spec §6). A 13-month-out date is still refused; it protects
  // against a fat-fingered YEAR, not against a genuine scheduled raise.
  it('refuses a valid_from more than 12 months in the future', async () => {
    const svc = service();
    const err = await svc
      .create(
        'parent-1',
        'h1',
        'carer-1',
        // NOW is 2026-08-04; 12 months out is 2027-08-04, so this is one day past it.
        request({ valid_from: '2027-08-05' }),
        NOW
      )
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(PayArrangementValidationError);
    expect((err as { metadata?: { reason?: string } }).metadata?.reason).toBe(
      'VALID_FROM_TOO_FAR_IN_FUTURE'
    );
  });

  it('accepts a valid_from exactly on the 12-month horizon', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ valid_from: '2027-08-04' }),
      NOW
    );
    expect(payRepo.create).toHaveBeenCalledTimes(1);
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
        overtime_daily_threshold_minutes: 480,
        doubletime_daily_threshold_minutes: 720,
        doubletime_multiplier: 2,
        seventh_day_multiplier: 1.5,
        seventh_day_doubletime_after_minutes: 480,
        worked_holiday_multiplier: 1.5,
        pay_frequency: 'biweekly',
        pay_day_of_week: 5,
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
      overtime_daily_threshold_minutes: 480,
      doubletime_daily_threshold_minutes: 720,
      doubletime_multiplier: 2,
      seventh_day_multiplier: 1.5,
      seventh_day_doubletime_after_minutes: 480,
      worked_holiday_multiplier: 1.5,
      pay_frequency: 'biweekly',
      pay_day_of_week: 5,
      pay_day_of_month: null,
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

  // 3-E2 / T17. The insert is a field-by-field literal with NO exhaustiveness
  // check, so a new arrangement column is one forgotten line away from never
  // persisting — and the failure is silent: the row saves, the parent sees
  // her terms echoed back from the form she just filled, and the engine
  // prices every week afterwards under terms nobody chose. These two tests
  // are the only compiler this layer has.
  it('persists the 078 daily/seventh-day tiers verbatim', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({
        overtime_daily_threshold_minutes: 480,
        doubletime_daily_threshold_minutes: 720,
        doubletime_multiplier: 2,
        seventh_day_multiplier: 1.5,
        seventh_day_doubletime_after_minutes: 480,
      }),
      NOW
    );
    const written = payRepo.create.mock.calls[0][0];
    expect(written.overtime_daily_threshold_minutes).toBe(480);
    expect(written.doubletime_daily_threshold_minutes).toBe(720);
    expect(written.doubletime_multiplier).toBe(2);
    expect(written.seventh_day_multiplier).toBe(1.5);
    expect(written.seventh_day_doubletime_after_minutes).toBe(480);
  });

  it('writes the 078 tiers as explicit nulls when omitted — null is the term "no such tier"', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    const written = payRepo.create.mock.calls[0][0];
    for (const column of [
      'overtime_daily_threshold_minutes',
      'doubletime_daily_threshold_minutes',
      'doubletime_multiplier',
      'seventh_day_multiplier',
      'seventh_day_doubletime_after_minutes',
    ] as const) {
      // `toHaveProperty` first: an omitted key and an explicit null are the
      // same row in Postgres but not the same intent at the call site, and
      // only the explicit form survives a future NOT NULL DEFAULT.
      expect(written).toHaveProperty(column);
      expect(written[column]).toBeNull();
    }
  });

  // 3-E4 / T17 again, for the one column 080 adds. Same trap, same two arms:
  // a forgotten line here means the family agrees a holiday premium, sees it
  // echoed back by the form, and is never charged it.
  it('persists worked_holiday_multiplier verbatim', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ worked_holiday_multiplier: 1.5 }),
      NOW
    );
    expect(payRepo.create.mock.calls[0][0].worked_holiday_multiplier).toBe(1.5);
  });

  it('writes worked_holiday_multiplier as an explicit null when omitted', async () => {
    // Null is the term "a worked holiday pays the normal rate", not "unset".
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    const written = payRepo.create.mock.calls[0][0];
    expect(written).toHaveProperty('worked_holiday_multiplier');
    expect(written.worked_holiday_multiplier).toBeNull();
  });

  // 082 / T17: pay frequency + pay day, presentation only — same trap as
  // 078/080, same two-arm test shape.
  it('persists the 082 pay-schedule fields verbatim', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({
        pay_frequency: 'semimonthly',
        pay_day_of_month: 15,
      }),
      NOW
    );
    const written = payRepo.create.mock.calls[0][0];
    expect(written.pay_frequency).toBe('semimonthly');
    expect(written.pay_day_of_week).toBeNull();
    expect(written.pay_day_of_month).toBe(15);
  });

  it('writes the 082 pay-schedule fields as explicit nulls when omitted', async () => {
    const payRepo = makePayRepo();
    const svc = service({ payRepo });
    await svc.create('parent-1', 'h1', 'carer-1', request(), NOW);
    const written = payRepo.create.mock.calls[0][0];
    for (const column of [
      'pay_frequency',
      'pay_day_of_week',
      'pay_day_of_month',
    ] as const) {
      expect(written).toHaveProperty(column);
      expect(written[column]).toBeNull();
    }
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

describe('PayArrangementCommandService.create — pay_terms_set forks on valid_from (D-16, attention spec §1.4)', () => {
  it('an immediate change (valid_from today) sends the ordinary title', async () => {
    const push = makePush();
    const svc = service({ push });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ valid_from: '2026-08-04' }),
      NOW
    );
    const [, payload] = push.notifyUser.mock.calls[0];
    expect(payload.data.type).toBe(PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET);
    expect(payload.title).toBe('Your pay terms changed.');
  });

  it('a scheduled future change names the date it takes effect', async () => {
    const push = makePush();
    const svc = service({ push });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ valid_from: '2026-09-01' }),
      NOW
    );
    const [, payload] = push.notifyUser.mock.calls[0];
    expect(payload.data.type).toBe(PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET);
    expect(payload.title).toBe('Your pay terms change on Sep 1.');
  });

  it('a backdated RAISE (no unapproved week prices lower) stays the ordinary pay_terms_set', async () => {
    const push = makePush();
    // Default weekEarnings fixture answers identically before/after — no
    // week prices lower, so this is an ordinary change even though it is
    // backdated.
    const timesheetRepo = makeTimesheetRepo([
      {
        household_id: 'h1',
        carer_id: 'carer-1',
        week_start: '2026-07-27',
        status: 'open',
      },
    ]);
    const svc = service({ push, timesheetRepo });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ rate_minor: 3000, valid_from: '2026-08-01' }),
      NOW
    );
    const [, payload] = push.notifyUser.mock.calls[0];
    expect(payload.data.type).toBe(PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET);
  });

  it('a backdated REDUCTION into an unapproved week sends pay_terms_backdated instead — never both (M1)', async () => {
    const push = makePush();
    const timesheetRepo = makeTimesheetRepo([
      {
        household_id: 'h1',
        carer_id: 'carer-1',
        week_start: '2026-07-27',
        status: 'submitted',
      },
    ]);
    const weekEarnings = makeWeekEarnings({
      '2026-07-27:before': { status: 'ok', gross_minor: 154_000 },
      '2026-07-27:after': { status: 'ok', gross_minor: 143_000 },
    });
    const svc = service({ push, timesheetRepo, weekEarnings });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ rate_minor: 1000, valid_from: '2026-08-01' }),
      NOW
    );
    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    const [, payload] = push.notifyUser.mock.calls[0];
    expect(payload.data.type).toBe(PUSH_NOTIFICATION_TYPES.PAY_TERMS_BACKDATED);
    expect(payload.title).toBe('Your terms were changed back to Aug 1.');
    // A8: no figures in the body.
    expect(payload.body).not.toMatch(/\$|£|€|\d/);
  });

  it('an APPROVED week is excluded from the reduction check — frozen totals never reopen it', async () => {
    const push = makePush();
    const timesheetRepo = makeTimesheetRepo([
      {
        household_id: 'h1',
        carer_id: 'carer-1',
        week_start: '2026-07-27',
        status: 'approved',
      },
    ]);
    const weekEarnings = makeWeekEarnings({
      // Even if this WOULD price lower, an approved week must not be checked.
      '2026-07-27:before': { status: 'ok', gross_minor: 154_000 },
      '2026-07-27:after': { status: 'ok', gross_minor: 100_000 },
    });
    const svc = service({ push, timesheetRepo, weekEarnings });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ rate_minor: 1000, valid_from: '2026-08-01' }),
      NOW
    );
    const [, payload] = push.notifyUser.mock.calls[0];
    expect(payload.data.type).toBe(PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET);
  });

  it('a backdate with no timesheet history at all stays the ordinary pay_terms_set', async () => {
    const push = makePush();
    const svc = service({ push, timesheetRepo: makeTimesheetRepo([]) });
    await svc.create(
      'parent-1',
      'h1',
      'carer-1',
      request({ rate_minor: 1000, valid_from: '2026-08-01' }),
      NOW
    );
    const [, payload] = push.notifyUser.mock.calls[0];
    expect(payload.data.type).toBe(PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET);
  });
});

describe('PayArrangementCommandService.cancelScheduled — D-16/§6, appends the revert row', () => {
  const SCHEDULED = {
    id: 'pa-scheduled',
    household_id: 'h1',
    carer_id: 'carer-1',
    rate_minor: 3000,
    currency: 'GBP',
    overtime_multiplier: 1.5,
    valid_from: '2026-09-01',
    valid_to: null,
    created_at: '2026-08-04T09:00:00.000Z',
    terms: {},
  };
  const CURRENT = {
    ...PREVIOUS_ARRANGEMENT,
    id: 'pa-current',
    rate_minor: 2500,
  };

  function payRepoWithScheduled(overrides: Record<string, unknown> = {}): any {
    return makePayRepo({
      findById: mock(async (id: string) =>
        id === 'pa-scheduled' ? SCHEDULED : null
      ),
      effectiveOn: mock(async () => CURRENT),
      ...overrides,
    });
  }

  it('appends a new row carrying the CURRENTLY in-effect terms at the scheduled date', async () => {
    const payRepo = payRepoWithScheduled();
    const svc = service({ payRepo });
    await svc.cancelScheduled('parent-1', 'h1', 'carer-1', 'pa-scheduled', NOW);

    expect(payRepo.create).toHaveBeenCalledTimes(1);
    const written = payRepo.create.mock.calls[0][0];
    expect(written.rate_minor).toBe(CURRENT.rate_minor);
    expect(written.valid_from).toBe('2026-09-01'); // the scheduled date, not today
  });

  it('notifies the carer with pay_terms_scheduled_change_cancelled, no figures, naming the date', async () => {
    const push = makePush();
    const svc = service({ payRepo: payRepoWithScheduled(), push });
    await svc.cancelScheduled('parent-1', 'h1', 'carer-1', 'pa-scheduled', NOW);

    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    const [recipientId, payload] = push.notifyUser.mock.calls[0];
    expect(recipientId).toBe('carer-1');
    expect(payload.data.type).toBe(
      PUSH_NOTIFICATION_TYPES.PAY_TERMS_SCHEDULED_CHANGE_CANCELLED
    );
    expect(payload.title).toBe('A change to your terms was called off');
    expect(payload.body).toContain('Sep 1');
    expect(payload.body).not.toMatch(/\$|£|€/);
  });

  it('refuses to cancel a change whose date has already arrived — it is in effect', async () => {
    const payRepo = payRepoWithScheduled({
      findById: mock(async () => ({ ...SCHEDULED, valid_from: '2026-08-01' })),
    });
    const svc = service({ payRepo });
    await expect(
      svc.cancelScheduled('parent-1', 'h1', 'carer-1', 'pa-scheduled', NOW)
    ).rejects.toBeInstanceOf(PayArrangementValidationError);
    expect(payRepo.create).not.toHaveBeenCalled();
  });

  it('a helper may not cancel a scheduled change', async () => {
    const svc = service({
      payRepo: payRepoWithScheduled(),
      members: { 'helper-1': HELPER, 'carer-1': NANNY },
    });
    await expect(
      svc.cancelScheduled('helper-1', 'h1', 'carer-1', 'pa-scheduled', NOW)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('refuses an arrangement id that is not a scheduled row of this household/carer', async () => {
    const svc = service({
      payRepo: payRepoWithScheduled({ findById: mock(async () => null) }),
    });
    await expect(
      svc.cancelScheduled('parent-1', 'h1', 'carer-1', 'nope', NOW)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });
});

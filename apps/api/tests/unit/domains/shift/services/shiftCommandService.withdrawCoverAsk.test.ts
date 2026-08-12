/**
 * Parent withdraw of an unanswered cover ask — D-22 / §5.3.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import { ShiftNotFoundError } from '../../../../../src/domains/shift/errors/shiftErrors';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import { ValidationError } from '../../../../../src/errors';

const pendingAsk: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T08:00:00.000Z',
  ends_at: '2026-08-03T17:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2026-08-03',
  kind: 'extra',
  status: 'pending',
  source_pattern_id: null,
  origin: 'parent_proposed',
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'uid-1',
  sequence: 0,
  created_by: 'parent-1',
  created_at: 't',
  updated_at: 't',
  cover_ask_expires_at: '2026-08-05T12:00:00.000Z',
  shift_children: [],
};

let ShiftCommandService: typeof import('../../../../../src/domains/shift/services/shiftCommandService').ShiftCommandService;
let detectUncoveredCareForDate: ReturnType<typeof mock>;

const NOTHING = { inserted: [], pushed: [] };

beforeAll(async () => {
  detectUncoveredCareForDate = mock(async () => NOTHING);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate,
      detectUncoveredCareBestEffort: mock(() => undefined),
    })
  );
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser: mock(() => undefined),
    notifyHouseholdParents: mock(() => undefined),
  }));

  ({ ShiftCommandService } = await import(
    '../../../../../src/domains/shift/services/shiftCommandService'
  ));
});

beforeEach(() => {
  detectUncoveredCareForDate.mockClear();
  detectUncoveredCareForDate.mockImplementation(async () => NOTHING);
});

function makeService(
  shift: ShiftWithChildren,
  membership: Record<string, unknown> | null
) {
  const withdrawCoverAsk = mock(async () => ({
    ...shift,
    status: 'cancelled',
    cancelled_by: 'parent-1',
    cancelled_at: '2026-08-04T10:00:00.000Z',
  }));

  return {
    svc: new ShiftCommandService(
      {
        withdrawCoverAsk,
        declinePending: mock(async () => shift),
        confirmPending: mock(async () => shift),
        applyParentEdit: mock(async () => shift),
        delete: mock(async () => undefined),
        assertMutable: mock(async () => undefined),
      } as any,
      {
        findActiveMembership: mock(async () => membership),
        findMembershipAnyStatus: mock(async () => membership),
      } as any,
      {
        getOwned: mock(async () => shift),
      } as any,
      { insertMany: mock(async () => undefined) } as any,
      { listForHousehold: mock(async () => []) } as any,
      { findById: mock(async () => ({ id: 'h1' })) } as any
    ),
    withdrawCoverAsk,
  };
}

describe('ShiftCommandService.withdrawCoverAsk', () => {
  it('lets a parent withdraw a pending unanswered cover ask', async () => {
    const { svc, withdrawCoverAsk } = makeService(pendingAsk, {
      role: 'parent',
      status: 'active',
    });
    const result = await svc.withdrawCoverAsk('parent-1', 's1');
    expect(withdrawCoverAsk).toHaveBeenCalledWith(
      's1',
      'parent-1',
      expect.any(String)
    );
    expect(result.status).toBe('cancelled');
    expect(result.cancelled_by).toBe('parent-1');
    expect(detectUncoveredCareForDate).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        localDate: '2026-08-03',
        cause: 'cancelled',
        actorId: 'parent-1',
      })
    );
  });

  it('refuses when the carer already accepted (confirmed)', async () => {
    const { svc, withdrawCoverAsk } = makeService(
      { ...pendingAsk, status: 'confirmed' },
      { role: 'parent', status: 'active' }
    );
    await expect(svc.withdrawCoverAsk('parent-1', 's1')).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(withdrawCoverAsk).not.toHaveBeenCalled();
  });

  it('refuses when the carer already declined', async () => {
    const { svc, withdrawCoverAsk } = makeService(
      { ...pendingAsk, status: 'declined' },
      { role: 'parent', status: 'active' }
    );
    await expect(svc.withdrawCoverAsk('parent-1', 's1')).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(withdrawCoverAsk).not.toHaveBeenCalled();
  });

  it('denies a nanny with 403 NotAHouseholdParentError', async () => {
    const { svc } = makeService(pendingAsk, {
      role: 'nanny',
      status: 'active',
    });
    await expect(svc.withdrawCoverAsk('carer-1', 's1')).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
  });

  it('returns opaque 404 when the shift is missing or not yours', async () => {
    const svc = new ShiftCommandService(
      { withdrawCoverAsk: mock(async () => pendingAsk) } as any,
      {
        findActiveMembership: mock(async () => null),
      } as any,
      {
        getOwned: mock(async () => {
          throw new ShiftNotFoundError('s1');
        }),
      } as any,
      { insertMany: mock(async () => undefined) } as any,
      { listForHousehold: mock(async () => []) } as any,
      { findById: mock(async () => null) } as any
    );
    await expect(svc.withdrawCoverAsk('parent-1', 's1')).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
  });

  it('refuses a pending shift that is not an outstanding cover ask', async () => {
    const { svc, withdrawCoverAsk } = makeService(
      { ...pendingAsk, cover_ask_expires_at: null, kind: 'recurring' },
      { role: 'parent', status: 'active' }
    );
    await expect(svc.withdrawCoverAsk('parent-1', 's1')).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(withdrawCoverAsk).not.toHaveBeenCalled();
  });
});

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { ShiftNotFoundError } from '../../../../../src/domains/shift/errors/shiftErrors';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

let ShiftQueryService: typeof import('../../../../../src/domains/shift/services/shiftQueryService').ShiftQueryService;
let raiseUncoveredOnceMock: ReturnType<typeof mock>;

beforeAll(async () => {
  raiseUncoveredOnceMock = mock(async () => []);
  mock.module(
    '../../../../../src/domains/child/services/uncoveredCareService',
    () => ({
      uncoveredCareService: { raiseUncoveredOnce: raiseUncoveredOnceMock },
    })
  );
  ({ ShiftQueryService } = await import(
    '../../../../../src/domains/shift/services/shiftQueryService'
  ));
});

beforeEach(() => {
  raiseUncoveredOnceMock.mockClear();
  raiseUncoveredOnceMock.mockImplementation(async () => []);
});

const shift: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T08:00:00.000Z',
  ends_at: '2026-08-03T17:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2026-08-03',
  kind: 'recurring',
  status: 'confirmed',
  source_pattern_id: null,
  origin: 'system_generated',
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'uid-1',
  sequence: 0,
  created_by: null,
  created_at: 't',
  updated_at: 't',
  shift_children: [],
};

const membership = {
  id: 'm1',
  household_id: 'h1',
  user_id: 'u1',
  role: 'parent',
};

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByHouseholdAndRange: mock(async () => [shift]),
    findByIdWithChildren: mock(async () => shift),
    update: mock(async () => shift),
    ...overrides,
  };
}

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForShift: mock(async () => [
      {
        id: 'e1',
        household_id: 'h1',
        shift_id: 's1',
        event_type: 'gap_raised',
      },
    ]),
    listForHouseholdDate: mock(async () => [
      {
        id: 'e2',
        household_id: 'h1',
        shift_id: null,
        event_type: 'uncovered_care',
      },
    ]),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => membership),
    ...overrides,
  };
}

describe('ShiftQueryService.listForHousehold', () => {
  it('lists the range once membership is confirmed', async () => {
    const svc = new ShiftQueryService(
      makeShiftRepo(),
      makeEventRepo(),
      makeMemberRepo()
    );
    expect(
      await svc.listForHousehold('u1', 'h1', '2026-08-01', '2026-08-08')
    ).toEqual([shift]);
  });

  it('throws for a non-member', async () => {
    const svc = new ShiftQueryService(
      makeShiftRepo(),
      makeEventRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) })
    );
    await expect(
      svc.listForHousehold('u2', 'h1', '2026-08-01', '2026-08-08')
    ).rejects.toBeInstanceOf(ShiftNotFoundError);
  });
});

describe('ShiftQueryService.getOwned', () => {
  it('returns the shift with children for an active household member', async () => {
    const svc = new ShiftQueryService(
      makeShiftRepo(),
      makeEventRepo(),
      makeMemberRepo()
    );
    expect(await svc.getOwned('u1', 's1')).toEqual(shift);
  });

  it('throws ShiftNotFoundError for a non-member (no existence leak)', async () => {
    const svc = new ShiftQueryService(
      makeShiftRepo(),
      makeEventRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) })
    );
    await expect(svc.getOwned('u2', 's1')).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
  });

  it('throws the SAME error for a truly missing shift', async () => {
    const svc = new ShiftQueryService(
      makeShiftRepo({ findByIdWithChildren: mock(async () => null) }),
      makeEventRepo(),
      makeMemberRepo()
    );
    await expect(svc.getOwned('u1', 'missing')).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
  });
});

describe('ShiftQueryService.listEvents', () => {
  it('lists the day thread once membership is confirmed', async () => {
    const svc = new ShiftQueryService(
      makeShiftRepo(),
      makeEventRepo(),
      makeMemberRepo()
    );
    const result = await svc.listEvents('u1', 'h1', 's1');
    expect(result).toHaveLength(1);
    expect(result[0]?.event_type).toBe('gap_raised');
  });

  it('throws for a non-member', async () => {
    const svc = new ShiftQueryService(
      makeShiftRepo(),
      makeEventRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) })
    );
    await expect(svc.listEvents('u2', 'h1', 's1')).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
  });
});

describe('ShiftQueryService.listDayThread', () => {
  it('returns the whole thread for a parent', async () => {
    const eventRepo = makeEventRepo();
    const svc = new ShiftQueryService(
      makeShiftRepo(),
      eventRepo,
      makeMemberRepo()
    );

    const result = await svc.listDayThread('u1', 'h1', '2026-08-03');

    expect(eventRepo.listForHouseholdDate).toHaveBeenCalledWith(
      'h1',
      '2026-08-03'
    );
    expect(result).toHaveLength(1);
  });

  /**
   * S14 — a read must not write. `listDayThread` used to run uncovered-care
   * detection (an INSERT into `shift_events`) before returning. Detection now
   * lives on the write paths, on `scheduleHorizonJob.sweepUncoveredCare`, and
   * on the explicit `shiftCommandService.refreshDayThread`.
   */
  it('never raises uncovered care — the read path writes nothing', async () => {
    const svc = new ShiftQueryService(
      makeShiftRepo(),
      makeEventRepo(),
      makeMemberRepo()
    );

    await svc.listDayThread('u1', 'h1', '2026-08-03');

    expect(raiseUncoveredOnceMock).not.toHaveBeenCalled();
  });

  it('throws for a non-member before touching the thread', async () => {
    const eventRepo = makeEventRepo();
    const svc = new ShiftQueryService(
      makeShiftRepo(),
      eventRepo,
      makeMemberRepo({ findActiveMembership: mock(async () => null) })
    );

    await expect(
      svc.listDayThread('u2', 'h1', '2026-08-03')
    ).rejects.toBeInstanceOf(ShiftNotFoundError);
    expect(eventRepo.listForHouseholdDate).not.toHaveBeenCalled();
  });
});

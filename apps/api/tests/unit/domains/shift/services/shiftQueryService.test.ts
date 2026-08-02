import { describe, expect, it, mock } from 'bun:test';
import { ShiftNotFoundError } from '../../../../../src/domains/shift/errors/shiftErrors';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import { ShiftQueryService } from '../../../../../src/domains/shift/services/shiftQueryService';

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
        event_type: 'coverage_gap',
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

const household = {
  id: 'h1',
  timezone: 'Europe/London',
};

const commitment = {
  id: 'cm1',
  child_id: 'child-1',
  household_id: 'h1',
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  start_time: '09:00',
  end_time: '12:00',
  starts_on: null,
  ends_on: null,
  exdates: [],
  excluded_from_cover: true,
};

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => household),
    ...overrides,
  };
}

function makeCommitmentRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByHouseholdId: mock(async () => [commitment]),
    ...overrides,
  };
}

function makeGapService(overrides: Record<string, unknown> = {}): any {
  return {
    raiseGapsOnce: mock(async () => []),
    ...overrides,
  };
}

/** The day-thread wiring needs all six collaborators — see `listDayThread`. */
function makeDayThreadService(
  repos: {
    shiftRepo?: any;
    eventRepo?: any;
    memberRepo?: any;
    householdRepo?: any;
    commitmentRepo?: any;
    gapService?: any;
  } = {}
): ShiftQueryService {
  return new ShiftQueryService(
    repos.shiftRepo ??
      makeShiftRepo({
        findByHouseholdAndLocalDate: mock(async () => [
          { ...shift, shift_children: [{ child_id: 'child-1' }] },
        ]),
      }),
    repos.eventRepo ?? makeEventRepo(),
    repos.memberRepo ?? makeMemberRepo(),
    repos.householdRepo ?? makeHouseholdRepo(),
    repos.commitmentRepo ?? makeCommitmentRepo(),
    repos.gapService ?? makeGapService()
  );
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
  it('raises that date coverage gaps BEFORE returning the thread (flow 1g production caller)', async () => {
    const shiftRepo = makeShiftRepo({
      findByHouseholdAndLocalDate: mock(async () => [
        {
          ...shift,
          shift_children: [
            { child_id: 'child-1', starts_at: null, ends_at: null },
          ],
        },
      ]),
    });
    const gapService = makeGapService();
    const eventRepo = makeEventRepo();
    const svc = makeDayThreadService({ shiftRepo, gapService, eventRepo });

    const result = await svc.listDayThread('u1', 'h1', '2026-08-03');

    expect(shiftRepo.findByHouseholdAndLocalDate).toHaveBeenCalledWith(
      'h1',
      '2026-08-03'
    );
    expect(gapService.raiseGapsOnce).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      'Europe/London', // the household timezone, not the shift's
      [
        {
          id: 's1',
          startsAt: shift.starts_at,
          endsAt: shift.ends_at,
          children: [{ childId: 'child-1', startsAt: null, endsAt: null }],
        },
      ],
      [
        {
          id: 'cm1',
          childId: 'child-1',
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          startTime: '09:00',
          endTime: '12:00',
          startsOn: null,
          endsOn: null,
          exdates: [],
          excludedFromCover: true,
        },
      ]
    );
    expect(eventRepo.listForHouseholdDate).toHaveBeenCalledWith(
      'h1',
      '2026-08-03'
    );
    expect(result).toHaveLength(1);
  });

  it('still returns the thread when gap detection blows up (best-effort side effect)', async () => {
    const gapService = makeGapService({
      raiseGapsOnce: mock(async () => {
        throw new Error('supabase is down');
      }),
    });
    const svc = makeDayThreadService({ gapService });

    const result = await svc.listDayThread('u1', 'h1', '2026-08-03');
    expect(result).toHaveLength(1);
  });

  it('never raises gaps for a non-member — membership is checked first', async () => {
    const gapService = makeGapService();
    const svc = makeDayThreadService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => null),
      }),
      gapService,
    });

    await expect(
      svc.listDayThread('u2', 'h1', '2026-08-03')
    ).rejects.toBeInstanceOf(ShiftNotFoundError);
    expect(gapService.raiseGapsOnce).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, mock } from 'bun:test';
import { ChildNotFoundError } from '../../../../../src/domains/child';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import {
  InvalidPatternCarerError,
  InvalidPatternChildError,
  NotThePatternCarerError,
  PatternMissingCarerError,
  PatternNotDraftError,
  PatternNotEditableError,
  PatternNotPendingError,
} from '../../../../../src/domains/schedule/errors/scheduleErrors';
import { SchedulePatternCommandService } from '../../../../../src/domains/schedule/services/schedulePatternCommandService';

const household = { id: 'h1', name: 'The Smiths', timezone: 'Europe/London' };

function patternFor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    household_id: 'h1',
    carer_id: 'carer-1',
    status: 'draft',
    rrule: 'FREQ=WEEKLY;INTERVAL=1',
    dtstart: '2026-02-02',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: 'The usual week',
    created_by: 'u1',
    sent_at: null,
    responded_at: null,
    ical_uid: 'pattern-uid',
    sequence: 0,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function membershipFor(role: string) {
  return { id: 'm1', household_id: 'h1', user_id: 'u1', role };
}

function makePatternRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...patternFor(),
      ...data,
      id: 'p-new',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...patternFor(),
      id,
      ...data,
    })),
    ...overrides,
  };
}

function makeDayRepo(overrides: Record<string, unknown> = {}): any {
  return {
    replaceForPattern: mock(async () => [
      {
        id: 'd1',
        pattern_id: 'p1',
        weekday: 4,
        start_time: '08:00',
        end_time: '17:00',
      },
    ]),
    ...overrides,
  };
}

function makeDayChildRepo(overrides: Record<string, unknown> = {}): any {
  return {
    insertForDay: mock(async () => []),
    ...overrides,
  };
}

function makeMemberRepo(
  role: string | null = 'owner',
  overrides: Record<string, unknown> = {}
): any {
  return {
    findActiveMembership: mock(async () => (role ? membershipFor(role) : null)),
    ...overrides,
  };
}

/**
 * A member repo that resolves a DIFFERENT role per user id — needed for the
 * D13 carer-role tests, where the CALLER (e.g. 'u1', an owner) and the
 * proposed carer_id (e.g. a co-parent, or a stranger) must be looked up
 * independently and can legitimately have different roles (or no
 * membership at all).
 */
function makeMemberRepoFor(roles: Record<string, string | null>): any {
  return {
    findActiveMembership: mock(async (_householdId: string, userId: string) => {
      const role = roles[userId];
      return role
        ? { id: `m-${userId}`, household_id: 'h1', user_id: userId, role }
        : null;
    }),
  };
}

function makeChildren(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(
      async (_userId: string, householdId: string, childId: string) => ({
        id: childId,
        household_id: householdId,
      })
    ),
    ...overrides,
  };
}

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => household),
    ...overrides,
  };
}

const defaultDays = [
  {
    id: 'd1',
    pattern_id: 'p1',
    weekday: 4,
    start_time: '08:00',
    end_time: '17:00',
    children: [],
  },
];

function makeQueries(
  pattern: Record<string, unknown> = patternFor(),
  overrides: Record<string, unknown> = {}
): any {
  return {
    getOwned: mock(async () => pattern),
    getWithDays: mock(async () => ({
      ...pattern,
      days: defaultDays,
    })),
    getDaysForPattern: mock(async () => defaultDays),
    ...overrides,
  };
}

function makeMaterialisation(overrides: Record<string, unknown> = {}): any {
  return {
    materialise: mock(async () => ({
      created: 1,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    })),
    ...overrides,
  };
}

describe('SchedulePatternCommandService.create', () => {
  it('creates a draft pattern for a parent caller, copying the household timezone', async () => {
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation()
    );

    await svc.create('u1', 'h1', {
      rrule: 'FREQ=WEEKLY;INTERVAL=1',
      dtstart: '2026-02-02',
    });

    expect(patternRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        status: 'draft',
        timezone: 'Europe/London',
        created_by: 'u1',
      })
    );
  });

  it('rejects a nanny caller', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('nanny'),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation()
    );
    await expect(
      svc.create('u1', 'h1', {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: '2026-02-02',
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  // D13 — SECURITY: carer_id was previously taken verbatim from the client
  // with no membership/role check at all.
  it('rejects a carer_id with no membership in the household at all', async () => {
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepoFor({ u1: 'owner' }), // 'stranger' resolves to no membership
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation()
    );

    await expect(
      svc.create('u1', 'h1', {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: '2026-02-02',
        carer_id: 'stranger',
      })
    ).rejects.toBeInstanceOf(InvalidPatternCarerError);
    expect(patternRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a carer_id assigned to a co-parent (an active member, but the wrong role)', async () => {
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepoFor({ u1: 'owner', 'co-parent-1': 'parent' }),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation()
    );

    await expect(
      svc.create('u1', 'h1', {
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: '2026-02-02',
        carer_id: 'co-parent-1',
      })
    ).rejects.toBeInstanceOf(InvalidPatternCarerError);
    expect(patternRepo.create).not.toHaveBeenCalled();
  });

  it('allows a carer_id that IS an active nanny member of the household', async () => {
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepoFor({ u1: 'owner', 'carer-1': 'nanny' }),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation()
    );

    await svc.create('u1', 'h1', {
      rrule: 'FREQ=WEEKLY;INTERVAL=1',
      dtstart: '2026-02-02',
      carer_id: 'carer-1',
    });

    expect(patternRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ carer_id: 'carer-1' })
    );
  });
});

describe('SchedulePatternCommandService.update', () => {
  it('allows editing a draft pattern', async () => {
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation()
    );
    await svc.update('u1', 'p1', { note: 'Updated' });
    expect(patternRepo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ note: 'Updated' })
    );
  });

  it('rejects editing a pattern that has already been sent', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'pending' })),
      makeMaterialisation()
    );
    await expect(
      svc.update('u1', 'p1', { note: 'Updated' })
    ).rejects.toBeInstanceOf(PatternNotEditableError);
  });
});

describe('SchedulePatternCommandService.replaceDays', () => {
  it('replaces days and their children wholesale, only while draft', async () => {
    const dayRepo = makeDayRepo();
    const dayChildRepo = makeDayChildRepo();
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      dayRepo,
      dayChildRepo,
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation(),
      makeChildren()
    );

    await svc.replaceDays('u1', 'p1', {
      days: [
        {
          weekday: 4,
          start_time: '08:00',
          end_time: '17:00',
          children: [{ child_id: 'child-1' }],
        },
      ],
    });

    expect(dayRepo.replaceForPattern).toHaveBeenCalledWith('p1', [
      { weekday: 4, start_time: '08:00', end_time: '17:00' },
    ]);
    expect(dayChildRepo.insertForDay).toHaveBeenCalledWith('d1', [
      { child_id: 'child-1' },
    ]);
  });

  // D14 — SECURITY: child_id was previously inserted verbatim from the
  // client with no check it belongs to the pattern's own household. The
  // sharpest possible violation of the cross-household anonymity promise:
  // one family's child appearing in a different, unrelated family's shift
  // data.
  it('rejects a child_id that belongs to a DIFFERENT household, and writes nothing', async () => {
    const dayRepo = makeDayRepo();
    const dayChildRepo = makeDayChildRepo();
    const children = makeChildren({
      getOwned: mock(async () => {
        throw new ChildNotFoundError('child-other-household');
      }),
    });
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      dayRepo,
      dayChildRepo,
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation(),
      children
    );

    await expect(
      svc.replaceDays('u1', 'p1', {
        days: [
          {
            weekday: 4,
            start_time: '08:00',
            end_time: '17:00',
            children: [{ child_id: 'child-other-household' }],
          },
        ],
      })
    ).rejects.toBeInstanceOf(InvalidPatternChildError);
    expect(dayRepo.replaceForPattern).not.toHaveBeenCalled();
    expect(dayChildRepo.insertForDay).not.toHaveBeenCalled();
  });

  it('rejects a child_id that does not exist at all, and writes nothing', async () => {
    const dayRepo = makeDayRepo();
    const dayChildRepo = makeDayChildRepo();
    const children = makeChildren({
      getOwned: mock(async () => {
        throw new ChildNotFoundError('missing-child');
      }),
    });
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      dayRepo,
      dayChildRepo,
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation(),
      children
    );

    await expect(
      svc.replaceDays('u1', 'p1', {
        days: [
          {
            weekday: 4,
            start_time: '08:00',
            end_time: '17:00',
            children: [{ child_id: 'missing-child' }],
          },
        ],
      })
    ).rejects.toBeInstanceOf(InvalidPatternChildError);
    expect(dayRepo.replaceForPattern).not.toHaveBeenCalled();
  });

  it('validates every child_id across every day before writing anything', async () => {
    const dayRepo = makeDayRepo();
    const dayChildRepo = makeDayChildRepo();
    const getOwned = mock(
      async (_userId: string, _householdId: string, childId: string) => {
        if (childId === 'child-bad') {
          throw new ChildNotFoundError(childId);
        }
        return { id: childId, household_id: 'h1' };
      }
    );
    const children = makeChildren({ getOwned });
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      dayRepo,
      dayChildRepo,
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation(),
      children
    );

    await expect(
      svc.replaceDays('u1', 'p1', {
        days: [
          {
            weekday: 1,
            start_time: '08:00',
            end_time: '17:00',
            children: [{ child_id: 'child-good' }],
          },
          {
            weekday: 3,
            start_time: '08:00',
            end_time: '17:00',
            children: [{ child_id: 'child-bad' }],
          },
        ],
      })
    ).rejects.toBeInstanceOf(InvalidPatternChildError);
    expect(dayRepo.replaceForPattern).not.toHaveBeenCalled();
  });
});

describe('SchedulePatternCommandService.send', () => {
  it('moves a draft pattern with a carer to pending', async () => {
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(),
      makeMaterialisation()
    );
    await svc.send('u1', 'p1');
    expect(patternRepo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ status: 'pending' })
    );
  });

  it('rejects sending a pattern with no carer assigned', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ carer_id: null })),
      makeMaterialisation()
    );
    await expect(svc.send('u1', 'p1')).rejects.toBeInstanceOf(
      PatternMissingCarerError
    );
  });

  it('rejects sending a pattern that is not a draft', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'pending' })),
      makeMaterialisation()
    );
    await expect(svc.send('u1', 'p1')).rejects.toBeInstanceOf(
      PatternNotDraftError
    );
  });
});

describe('SchedulePatternCommandService.respond', () => {
  it('accepting materialises shifts from the pattern', async () => {
    const materialisation = makeMaterialisation();
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('nanny'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'pending' })),
      materialisation
    );
    const result = await svc.respond('carer-1', 'p1', { status: 'accepted' });
    expect(result.status).toBe('accepted');
    expect(materialisation.materialise).toHaveBeenCalledTimes(1);
    const [patternArg, occurrencesArg] =
      materialisation.materialise.mock.calls[0];
    expect(patternArg).toEqual(
      expect.objectContaining({ id: 'p1', icalUid: 'pattern-uid' })
    );
    expect(Array.isArray(occurrencesArg)).toBe(true);
    expect(occurrencesArg.length).toBeGreaterThan(0);
  });

  it('declining does NOT materialise shifts', async () => {
    const materialisation = makeMaterialisation();
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('nanny'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'pending' })),
      materialisation
    );
    const result = await svc.respond('carer-1', 'p1', { status: 'declined' });
    expect(result.status).toBe('declined');
    expect(materialisation.materialise).not.toHaveBeenCalled();
  });

  it('rejects a caller who is not the assigned carer', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'pending' })),
      makeMaterialisation()
    );
    await expect(
      svc.respond('u1', 'p1', { status: 'accepted' })
    ).rejects.toBeInstanceOf(NotThePatternCarerError);
  });

  it('rejects responding to a pattern that is not pending', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('nanny'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'draft' })),
      makeMaterialisation()
    );
    await expect(
      svc.respond('carer-1', 'p1', { status: 'accepted' })
    ).rejects.toBeInstanceOf(PatternNotPendingError);
  });
});

describe('SchedulePatternCommandService.materialiseForHorizon', () => {
  it('materialises an accepted pattern using days fetched WITHOUT an ownership check', async () => {
    const materialisation = makeMaterialisation();
    const queries = makeQueries(patternFor({ status: 'accepted' }));
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      queries,
      materialisation
    );

    const pattern = patternFor({ status: 'accepted' }) as any;
    const result = await svc.materialiseForHorizon(pattern);

    expect(queries.getDaysForPattern).toHaveBeenCalledWith('p1');
    expect(queries.getOwned).not.toHaveBeenCalled();
    expect(materialisation.materialise).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({ created: 1, conflicts: [] })
    );
  });

  it('respects a custom horizon override, defaulting to the 84-day acceptance horizon', async () => {
    const materialisation = makeMaterialisation();
    const queries = makeQueries();
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      queries,
      materialisation
    );

    await svc.materialiseForHorizon(patternFor() as any, 30);

    expect(materialisation.materialise).toHaveBeenCalledTimes(1);
  });
});

describe('SchedulePatternCommandService.withdraw', () => {
  it('withdraws a pending pattern', async () => {
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'pending' })),
      makeMaterialisation()
    );
    await svc.withdraw('u1', 'p1');
    expect(patternRepo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ status: 'withdrawn' })
    );
  });

  it('rejects withdrawing a draft pattern (nothing was sent yet)', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'draft' })),
      makeMaterialisation()
    );
    await expect(svc.withdraw('u1', 'p1')).rejects.toBeInstanceOf(
      PatternNotPendingError
    );
  });
});

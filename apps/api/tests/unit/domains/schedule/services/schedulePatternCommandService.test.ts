import { describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ChildNotFoundError } from '../../../../../src/domains/child';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import {
  InvalidPatternCarerError,
  InvalidPatternChildError,
  NotThePatternCarerError,
  PatternMissingCarerError,
  PatternNotAcceptedError,
  PatternNotDraftError,
  PatternNotEditableError,
  PatternNotPendingError,
} from '../../../../../src/domains/schedule/errors/scheduleErrors';
import type { NewShiftData } from '../../../../../src/domains/schedule/repositories/scheduleShiftRepository';
import type {
  ConflictEventRepository,
  MaterialisationShiftRepository,
  TimeEntryExistenceRepository,
} from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';
import { ScheduleMaterialisationService } from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';
import { SchedulePatternCommandService } from '../../../../../src/domains/schedule/services/schedulePatternCommandService';
import { ValidationError } from '../../../../../src/errors';

const household = { id: 'h1', name: 'The Smiths', timezone: 'Europe/London' };

/**
 * Fixed clock for amend / horizon tests. Materialisation reconciles "future"
 * against this instant (not the wall clock), so fixture dates never time-bomb.
 */
const NOW = new Date('2026-08-03T12:00:00.000Z');

/** Thursday on/after NOW+28d — matches `defaultDays` weekday 4. */
function futureThursdayExdate(from: Date = NOW, minDaysAhead = 28): string {
  const startMs = from.getTime() + minDaysAhead * 24 * 60 * 60 * 1000;
  const d = new Date(
    Date.UTC(
      new Date(startMs).getUTCFullYear(),
      new Date(startMs).getUTCMonth(),
      new Date(startMs).getUTCDate()
    )
  );
  while (d.getUTCDay() !== 4) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

const FUTURE_EXDATE = futureThursdayExdate();

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
    // Supersede-on-accept's lookup — no prior accepted pattern by default.
    // Its own behaviour is covered in `schedulePatternSupersede.test.ts`.
    listAcceptedByHouseholdAndCarer: mock(async () => []),
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
      touchedDates: [],
    })),
    // Every path that ends a pattern withdraws its future shifts through
    // here — covered in `scheduleMaterialisationDedupe.test.ts` /
    // `schedulePatternSupersede.test.ts`.
    cancelFutureShiftsForEndedPattern: mock(async () => 0),
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

  // F-B3b-1 / F-B7-2 (S0): the schema no longer carries `status`, but the
  // service must ALSO never forward one to the repository — belt and
  // braces, since the schema alone isn't the thing that writes. `as any`
  // simulates a stray key that reached the service despite validation
  // (e.g. a future schema regression), so this stays red if either layer
  // regresses on its own.
  it('never forwards a status field to the repository, even if one reaches the service', async () => {
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
    await svc.update('u1', 'p1', {
      note: 'Updated',
      status: 'accepted',
    } as any);
    const patch = patternRepo.update.mock.calls[0][1];
    expect(patch).not.toHaveProperty('status');
    expect(patch).toEqual({ note: 'Updated' });
  });

  // Reviewer follow-up on F-B3b-1: `create` validates carer_id via
  // assertCarerRole (:115-117); `update` forwarded it unvalidated. A parent
  // could PATCH carer_id to their own id, then send + respond(accepted) as
  // "the carer" — same forced-accept outcome, one column over. Closing this
  // at `update` closes the whole chain: send/respond can never run once
  // this rejects.
  it('rejects a carer_id that is not an active nanny member — closes the self-assign-then-accept chain', async () => {
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepoFor({ 'parent-1': 'parent' }),
      makeHouseholdRepo(),
      makeQueries(patternFor({ carer_id: null, status: 'draft' })),
      makeMaterialisation()
    );

    await expect(
      svc.update('parent-1', 'p1', { carer_id: 'parent-1' })
    ).rejects.toBeInstanceOf(InvalidPatternCarerError);
    expect(patternRepo.update).not.toHaveBeenCalled();
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

  it('correlates returned days to inputs by weekday and start_time, not index', async () => {
    const dayRepo = makeDayRepo({
      replaceForPattern: mock(async () => [
        // Mock returns them REVERSED vs the input array
        {
          id: 'd-1500',
          pattern_id: 'p1',
          weekday: 1,
          start_time: '15:00:00',
          end_time: '17:00:00',
        },
        {
          id: 'd-0700',
          pattern_id: 'p1',
          weekday: 1,
          start_time: '07:00:00',
          end_time: '13:00:00',
        },
      ]),
    });
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
          weekday: 1,
          start_time: '07:00',
          end_time: '13:00',
          children: [{ child_id: 'child-A' }],
        },
        {
          weekday: 1,
          start_time: '15:00',
          end_time: '17:00',
          children: [{ child_id: 'child-B' }],
        },
      ],
    });

    expect(dayChildRepo.insertForDay).toHaveBeenCalledWith('d-0700', [
      { child_id: 'child-A', start_time: undefined, end_time: undefined },
    ]);
    expect(dayChildRepo.insertForDay).toHaveBeenCalledWith('d-1500', [
      { child_id: 'child-B', start_time: undefined, end_time: undefined },
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

  // Reviewer follow-up on F-B3b-1: respond() checked identity
  // (pattern.carer_id === userId) but never the caller's role, unlike its
  // exact analogue `shiftCommandService.accept` (:68-72). If carer_id was
  // ever set to a non-carer's id (e.g. via the update() gap above, before
  // that was closed), that member could still self-accept. Same error as
  // the identity mismatch, mirroring `accept`'s "same error either way".
  it('rejects a non-carer member responding, even when carer_id happens to match their own id', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepoFor({ 'parent-1': 'parent' }),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'pending', carer_id: 'parent-1' })),
      makeMaterialisation()
    );
    await expect(
      svc.respond('parent-1', 'p1', { status: 'accepted' })
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

    await svc.materialiseForHorizon(patternFor() as any, 30, NOW);

    expect(materialisation.materialise).toHaveBeenCalledTimes(1);
    expect(materialisation.materialise.mock.calls[0][2]).toEqual(NOW);
  });

  it('marks accepted pattern ended when until is past in the pattern timezone', async () => {
    // UTC still 2026-08-03; Pacific/Auckland is already 2026-08-04.
    const now = new Date('2026-08-03T12:00:00.000Z');
    const pattern = patternFor({
      status: 'accepted',
      timezone: 'Pacific/Auckland',
      until: '2026-08-03',
    });
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(pattern),
      makeMaterialisation()
    );

    await svc.materialiseForHorizon(pattern as any, 30, now);

    expect(patternRepo.update).toHaveBeenCalledWith('p1', {
      status: 'ended',
    });
  });

  it('does not mark ended when until equals today in the zone even though UTC has rolled', async () => {
    // UTC already 2026-08-04; America/Los_Angeles is still 2026-08-03.
    const now = new Date('2026-08-04T06:00:00.000Z');
    const pattern = patternFor({
      status: 'accepted',
      timezone: 'America/Los_Angeles',
      until: '2026-08-03',
    });
    const patternRepo = makePatternRepo();
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(pattern),
      makeMaterialisation()
    );

    await svc.materialiseForHorizon(pattern as any, 30, now);

    expect(patternRepo.update).not.toHaveBeenCalled();
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

function baseShiftForAmend(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: `${FUTURE_EXDATE}T07:00:00.000Z`,
    ends_at: `${FUTURE_EXDATE}T16:00:00.000Z`,
    timezone: 'Europe/London',
    local_date: FUTURE_EXDATE,
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: 'p1',
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: `pattern-uid::${FUTURE_EXDATE}`,
    sequence: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeShiftRepo(
  overrides: Partial<MaterialisationShiftRepository> = {}
): MaterialisationShiftRepository {
  return {
    findActiveByPattern: mock(async () => []),
    findRecurringInWindow: mock(async () => null),
    shiftIdsWithChangeRequests: mock(async () => new Set<string>()),
    create: mock(async () => baseShiftForAmend()),
    update: mock(async () => baseShiftForAmend()),
    createMany: mock(async (rows: NewShiftData[]) =>
      rows.map((row, index) =>
        baseShiftForAmend({ id: `shift-${index + 1}`, ical_uid: row.ical_uid })
      )
    ),
    updateMany: mock(async () => undefined),
    deleteMany: mock(async () => undefined),
    replaceChildrenMany: mock(async () => undefined),
    ...overrides,
  };
}

function makeTimeEntryRepo(
  overrides: Partial<TimeEntryExistenceRepository> = {}
): TimeEntryExistenceRepository {
  return {
    shiftIdsWithTimeEntries: mock(async () => new Set<string>()),
    ...overrides,
  };
}

function makeEventRepo(
  overrides: Partial<ConflictEventRepository> = {}
): ConflictEventRepository {
  return {
    listEventKeysForDate: mock(async () => new Set<string>()),
    insertMany: mock(async () => undefined),
    ...overrides,
  };
}

describe('SchedulePatternCommandService.amend', () => {
  it('adding exdate to accepted pattern deletes untouched future shift', async () => {
    const accepted = patternFor({ status: 'accepted', exdates: [] });
    const orphan = baseShiftForAmend({ id: 'shift-to-exclude' });
    const shiftRepo = makeShiftRepo({
      findActiveByPattern: mock(async () => [orphan]),
    });
    const materialisation = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );
    const patternRepo = makePatternRepo({
      update: mock(async (id: string, data: Record<string, unknown>) => ({
        ...accepted,
        id,
        ...data,
      })),
    });
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(accepted),
      materialisation
    );

    await svc.amend('u1', 'p1', { exdates: [FUTURE_EXDATE] }, NOW);

    expect(patternRepo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ exdates: [FUTURE_EXDATE] })
    );
    expect(shiftRepo.deleteMany).toHaveBeenCalledWith(['shift-to-exclude']);
  });

  it('preserves a shift with time entries in an excluded range', async () => {
    const accepted = patternFor({ status: 'accepted', exdates: [] });
    const paidOrphan = baseShiftForAmend({ id: 'shift-paid' });
    const shiftRepo = makeShiftRepo({
      findActiveByPattern: mock(async () => [paidOrphan]),
    });
    const timeEntryRepo = makeTimeEntryRepo({
      shiftIdsWithTimeEntries: mock(async (ids: string[]) => new Set(ids)),
    });
    const materialisation = new ScheduleMaterialisationService(
      shiftRepo,
      timeEntryRepo,
      makeEventRepo()
    );
    const patternRepo = makePatternRepo({
      update: mock(async (id: string, data: Record<string, unknown>) => ({
        ...accepted,
        id,
        ...data,
      })),
    });
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(accepted),
      materialisation
    );

    await svc.amend('u1', 'p1', { exdates: [FUTURE_EXDATE] }, NOW);

    expect(shiftRepo.deleteMany).not.toHaveBeenCalled();
    expect(shiftRepo.update).not.toHaveBeenCalled();
    expect(shiftRepo.updateMany).not.toHaveBeenCalled();
  });

  it('cancels a manually-touched shift with a pattern_conflict event', async () => {
    const accepted = patternFor({ status: 'accepted', exdates: [] });
    const touched = baseShiftForAmend({
      id: 'shift-touched',
      origin: 'nanny_countered',
    });
    const shiftRepo = makeShiftRepo({
      findActiveByPattern: mock(async () => [touched]),
    });
    const eventRepo = makeEventRepo();
    const materialisation = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      eventRepo
    );
    const patternRepo = makePatternRepo({
      update: mock(async (id: string, data: Record<string, unknown>) => ({
        ...accepted,
        id,
        ...data,
      })),
    });
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(accepted),
      materialisation
    );

    await svc.amend('u1', 'p1', { exdates: [FUTURE_EXDATE] }, NOW);

    expect(shiftRepo.deleteMany).not.toHaveBeenCalled();
    expect(shiftRepo.updateMany).toHaveBeenCalledWith(
      ['shift-touched'],
      expect.objectContaining({
        status: 'cancelled',
        reason: 'pattern_changed',
      })
    );
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        shift_id: 'shift-touched',
        event_type: 'pattern_conflict',
        local_date: FUTURE_EXDATE,
      }),
    ]);
  });

  it('flips status to ended when until is before today in the pattern timezone', async () => {
    // UTC still 2026-08-03; Pacific/Auckland is already 2026-08-04 — UTC
    // cutoff would leave the pattern accepted ~13h late.
    const now = new Date('2026-08-03T12:00:00.000Z');
    const accepted = patternFor({
      status: 'accepted',
      timezone: 'Pacific/Auckland',
      dtstart: '2026-02-02',
      until: null,
    });
    const patternRepo = makePatternRepo({
      update: mock(async (id: string, data: Record<string, unknown>) => ({
        ...accepted,
        id,
        ...data,
      })),
    });
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(accepted),
      makeMaterialisation()
    );

    await svc.amend('u1', 'p1', { until: '2026-08-03' }, now);

    expect(patternRepo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        until: '2026-08-03',
        status: 'ended',
      })
    );
  });

  it('does not end when until equals today in the pattern timezone', async () => {
    const now = new Date('2026-08-03T12:00:00.000Z');
    const accepted = patternFor({
      status: 'accepted',
      timezone: 'Pacific/Auckland',
      dtstart: '2026-02-02',
      until: null,
    });
    const patternRepo = makePatternRepo({
      update: mock(async (id: string, data: Record<string, unknown>) => ({
        ...accepted,
        id,
        ...data,
      })),
    });
    const svc = new SchedulePatternCommandService(
      patternRepo,
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(accepted),
      makeMaterialisation()
    );

    await svc.amend('u1', 'p1', { until: '2026-08-04' }, now);

    expect(patternRepo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ until: '2026-08-04' })
    );
    expect(patternRepo.update).toHaveBeenCalledWith(
      'p1',
      expect.not.objectContaining({ status: 'ended' })
    );
  });

  it('rejects until before dtstart with ValidationError', async () => {
    const accepted = patternFor({
      status: 'accepted',
      dtstart: '2026-02-02',
    });
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(accepted),
      makeMaterialisation()
    );

    await expect(
      svc.amend('u1', 'p1', { until: '2026-01-01' }, NOW)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects amending a draft pattern', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'draft' })),
      makeMaterialisation()
    );
    await expect(
      svc.amend('u1', 'p1', { exdates: [FUTURE_EXDATE] })
    ).rejects.toBeInstanceOf(PatternNotAcceptedError);
  });

  it('rejects amending a withdrawn pattern', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('owner'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'withdrawn' })),
      makeMaterialisation()
    );
    await expect(
      svc.amend('u1', 'p1', { until: '2026-12-01' })
    ).rejects.toBeInstanceOf(PatternNotAcceptedError);
  });

  it('rejects a non-parent caller', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo('nanny'),
      makeHouseholdRepo(),
      makeQueries(patternFor({ status: 'accepted' })),
      makeMaterialisation()
    );
    await expect(
      svc.amend('u1', 'p1', { exdates: [FUTURE_EXDATE] })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});

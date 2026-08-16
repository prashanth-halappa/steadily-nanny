/**
 * @module tests/unit/domains/timesheet/services/timesheetCommandService.viewed.test
 *
 * The parent's one-way Hours receipt — WHETHER she opened the week, never
 * how many times. Mirrors `termsProposalCommandService.markViewed`: the
 * carer never stamps, an already-stamped row is a no-op, a concurrent
 * stamp returning null is not an error, and there is no push.
 */
import { describe, expect, it, mock } from 'bun:test';

/**
 * The terms gate, stubbed to "agreed", registered BEFORE the service is
 * imported below (same shape as `timesheetCommandService.test.ts`).
 */
mock.module('../../../../../src/domains/pay/services/termsGateService', () => ({
  termsGateService: { assertAgreed: mock(async () => undefined) },
  TermsGateService: class {},
}));

import { NotATimesheetParentError } from '../../../../../src/domains/timesheet/errors/timesheetErrors';
import { TimesheetCommandService } from '../../../../../src/domains/timesheet/services/timesheetCommandService';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const VIEWED_AT = NOW.toISOString();

const submittedTimesheet = {
  id: 'ts1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  week_start: '2026-08-03',
  total_minutes: 480,
  status: 'submitted',
  approved_by: null,
  approved_at: null,
  query_note: null,
  reopen_reason: null,
  parent_viewed_at: null,
  created_at: 't',
  updated_at: 't',
};

function makeTimesheetRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByWeek: mock(async () => null),
    create: mock(async (data: Record<string, unknown>) => ({
      ...submittedTimesheet,
      id: 'ts-created',
      ...data,
    })),
    update: mock(async (id: string, patch: Record<string, unknown>) => ({
      ...submittedTimesheet,
      id,
      ...patch,
    })),
    approveSubmittedWithEarnings: mock(async () => null),
    stampParentViewed: mock(async (id: string, viewedAt: string) => ({
      ...submittedTimesheet,
      id,
      parent_viewed_at: viewedAt,
    })),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'parent-1',
      role: 'parent',
    })),
    ...overrides,
  };
}

function makeHouseholdRepo(): any {
  return {
    findById: mock(async () => ({ id: 'h1', timezone: 'Europe/London' })),
  };
}

function makeShiftRepo(): any {
  return {
    findById: mock(async () => null),
    findByHouseholdAndRange: mock(async () => []),
  };
}

function makeQueries(
  timesheet: Record<string, unknown> = submittedTimesheet
): any {
  return {
    getOwnedTimesheet: mock(async () => timesheet),
  };
}

function makeUserService(): any {
  return {
    getProfileById: mock(async () => ({
      user_id: 'carer-1',
      name: 'Nia Rowe',
    })),
  };
}

function makePush(overrides: Record<string, unknown> = {}): any {
  return {
    notifyUser: mock(() => undefined),
    notifyHouseholdParents: mock(() => undefined),
    ...overrides,
  };
}

function makeTimeEntryRepo(): any {
  return {
    findRunningForCarer: mock(async () => null),
  };
}

function makeService(overrides: Record<string, unknown> = {}): any {
  const deps = {
    timeEntryRepo: makeTimeEntryRepo(),
    timesheetRepo: makeTimesheetRepo(),
    memberRepo: makeMemberRepo(),
    queries: makeQueries(),
    push: makePush(),
    ...overrides,
  };
  return {
    ...deps,
    svc: new TimesheetCommandService(
      deps.timeEntryRepo,
      deps.timesheetRepo,
      deps.memberRepo,
      makeHouseholdRepo(),
      makeShiftRepo(),
      deps.queries,
      makeUserService(),
      deps.push
    ),
  };
}

describe('TimesheetCommandService.markParentViewed — one-way receipt', () => {
  it('stamps parent_viewed_at for an active parent on a submitted week', async () => {
    const { svc, timesheetRepo } = makeService();
    const row = await svc.markParentViewed('parent-1', 'ts1', () => NOW);
    expect(timesheetRepo.stampParentViewed).toHaveBeenCalledWith(
      'ts1',
      VIEWED_AT
    );
    expect(row.parent_viewed_at).toBe(VIEWED_AT);
    expect(row.id).toBe('ts1');
  });

  it('refuses for the carer', async () => {
    const { svc, timesheetRepo } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm1',
          household_id: 'h1',
          user_id: 'carer-1',
          role: 'nanny',
        })),
      }),
    });
    await expect(
      svc.markParentViewed('carer-1', 'ts1', () => NOW)
    ).rejects.toBeInstanceOf(NotATimesheetParentError);
    expect(timesheetRepo.stampParentViewed).not.toHaveBeenCalled();
  });

  it('refuses for a removed member', async () => {
    const { svc, timesheetRepo } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => null),
      }),
    });
    await expect(
      svc.markParentViewed('parent-1', 'ts1', () => NOW)
    ).rejects.toBeInstanceOf(NotATimesheetParentError);
    expect(timesheetRepo.stampParentViewed).not.toHaveBeenCalled();
  });

  it('is a no-op when parent_viewed_at is already set', async () => {
    const already = {
      ...submittedTimesheet,
      parent_viewed_at: '2026-08-10T09:00:00.000Z',
    };
    const { svc, timesheetRepo } = makeService({
      queries: makeQueries(already),
    });
    const row = await svc.markParentViewed('parent-1', 'ts1', () => NOW);
    expect(timesheetRepo.stampParentViewed).not.toHaveBeenCalled();
    expect(row.parent_viewed_at).toBe('2026-08-10T09:00:00.000Z');
  });

  it('is a no-op on an approved week', async () => {
    const approved = { ...submittedTimesheet, status: 'approved' };
    const { svc, timesheetRepo } = makeService({
      queries: makeQueries(approved),
    });
    const row = await svc.markParentViewed('parent-1', 'ts1', () => NOW);
    expect(timesheetRepo.stampParentViewed).not.toHaveBeenCalled();
    expect(row.status).toBe('approved');
  });

  it('is a no-op on an open week', async () => {
    const open = { ...submittedTimesheet, status: 'open' };
    const { svc, timesheetRepo } = makeService({
      queries: makeQueries(open),
    });
    const row = await svc.markParentViewed('parent-1', 'ts1', () => NOW);
    expect(timesheetRepo.stampParentViewed).not.toHaveBeenCalled();
    expect(row.status).toBe('open');
  });

  it('returns the pre-read row when a concurrent stamp returns null', async () => {
    const { svc, timesheetRepo } = makeService({
      timesheetRepo: makeTimesheetRepo({
        stampParentViewed: mock(async () => null),
      }),
    });
    const row = await svc.markParentViewed('parent-1', 'ts1', () => NOW);
    expect(timesheetRepo.stampParentViewed).toHaveBeenCalledTimes(1);
    expect(row.id).toBe('ts1');
    expect(row.parent_viewed_at).toBeNull();
  });

  it('never calls approveSubmittedWithEarnings or update', async () => {
    const { svc, timesheetRepo } = makeService();
    await svc.markParentViewed('parent-1', 'ts1', () => NOW);
    expect(timesheetRepo.approveSubmittedWithEarnings).not.toHaveBeenCalled();
    expect(timesheetRepo.update).not.toHaveBeenCalled();
  });
});

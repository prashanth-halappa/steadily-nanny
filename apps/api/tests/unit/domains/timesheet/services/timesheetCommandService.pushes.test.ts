/**
 * The SUBMIT-leg push: a parent learns her nanny's week is in the moment it
 * lands, not at 09:00 the next morning.
 *
 * Until this file existed the only signal on submit was `reminderJob.ts`'s
 * daily digest, and the roll-up's own fan-out was untested on the create
 * branch — where it was also missing `timesheetId`, the field the mobile
 * route map's `hoursHref` needs to deep-link the parent straight at the week.
 *
 * WHAT IS PINNED HERE
 *  1. The push fires on a transition INTO 'submitted' — both ways in: the
 *     first clock-out of a week (the timesheet is CREATED submitted) and a
 *     roll-up re-opening an 'approved'/'queried' week.
 *  2. It does NOT fire on a roll-up that leaves an already-'submitted' week
 *     submitted. That is the common case (a second clock-out on Wednesday),
 *     and pushing there would notify a parent about nothing.
 *  3. Its `data` is exactly `{ type, householdId, weekStart, timesheetId }`.
 *  4. A push failure NEVER fails the write. The hours happened; a dead Expo
 *     must not be able to reject them.
 */
import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { TimesheetCommandService } from '../../../../../src/domains/timesheet/services/timesheetCommandService';

const runningEntry = {
  id: 't1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  shift_id: null,
  clock_in_at: '2026-08-03T08:00:00.000Z',
  clock_out_at: null,
  break_minutes: 0,
  scheduled_minutes: null,
  kind: 'worked',
  note: null,
  clock_in_location_ok: null,
  clock_out_location_ok: null,
  status: 'running',
  local_date: '2026-08-03',
  timezone: 'Europe/London',
  created_at: 't',
  updated_at: 't',
};

const finishedEntry = {
  ...runningEntry,
  clock_out_at: '2026-08-03T16:00:00.000Z',
  status: 'submitted',
};

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
  created_at: 't',
  updated_at: 't',
};

function makeTimeEntryRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findRunningForCarer: mock(async () => null),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      ...runningEntry,
      ...patch,
    })),
    listForCarerWeek: mock(async () => [finishedEntry]),
    listOverlapCandidatesForCarer: mock(async () => []),
    ...overrides,
  };
}

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
    ...overrides,
  };
}

function makeMemberRepo(): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'carer-1',
      role: 'nanny',
    })),
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

function makeQueries(): any {
  return {
    getOwnedTimeEntry: mock(async () => runningEntry),
    getOwnedTimesheet: mock(async () => submittedTimesheet),
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

function makeService(overrides: Record<string, unknown> = {}): any {
  const deps = {
    timeEntryRepo: makeTimeEntryRepo(),
    timesheetRepo: makeTimesheetRepo(),
    push: makePush(),
    ...overrides,
  };
  return {
    ...deps,
    svc: new TimesheetCommandService(
      deps.timeEntryRepo,
      deps.timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      deps.push
    ),
  };
}

/** The one clock-out every test here drives the roll-up with. */
function clockOut(svc: TimesheetCommandService): Promise<unknown> {
  return svc.clockOut('carer-1', 't1', {
    clock_out_at: '2026-08-03T16:00:00.000Z',
  });
}

describe('rollUpIntoTimesheet — TIMESHEET_SUBMITTED push on the way INTO submitted', () => {
  it('fires on the first clock-out of the week, with the CREATED timesheet id in the payload', async () => {
    const { svc, push } = makeService();

    await clockOut(svc);

    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [householdId, payload] = push.notifyHouseholdParents.mock
      .calls[0] as [string, { data: Record<string, unknown> }];
    expect(householdId).toBe('h1');
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED,
      householdId: 'h1',
      weekStart: '2026-08-03',
      timesheetId: 'ts-created',
    });
  });

  it('fires when a roll-up re-opens an APPROVED week, naming that week', async () => {
    const { svc, push } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findByWeek: mock(async () => ({
          ...submittedTimesheet,
          id: 'ts-approved',
          status: 'approved',
          approved_by: 'parent-1',
        })),
      }),
    });

    await clockOut(svc);

    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [, payload] = push.notifyHouseholdParents.mock.calls[0] as [
      string,
      { data: Record<string, unknown> },
    ];
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED,
      householdId: 'h1',
      weekStart: '2026-08-03',
      timesheetId: 'ts-approved',
    });
  });

  it('fires when a roll-up moves an OPEN week to submitted', async () => {
    const { svc, push } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findByWeek: mock(async () => ({
          ...submittedTimesheet,
          id: 'ts-open',
          status: 'open',
        })),
      }),
    });

    await clockOut(svc);

    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when the week was ALREADY submitted — that is not a transition', async () => {
    const { svc, push } = makeService({
      timesheetRepo: makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...submittedTimesheet })),
      }),
    });

    await clockOut(svc);

    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('never notifies the carer herself on submit — she is the one who submitted it', async () => {
    const { svc, push } = makeService();

    await clockOut(svc);

    expect(push.notifyUser).not.toHaveBeenCalled();
  });

  it('a push failure never fails the write — the hours are recorded regardless', async () => {
    const { svc, timesheetRepo } = makeService({
      push: makePush({
        notifyHouseholdParents: mock(() => {
          throw new Error('expo down');
        }),
      }),
    });

    const entry = (await clockOut(svc)) as { status: string };

    expect(entry.status).toBe('submitted');
    expect(timesheetRepo.create).toHaveBeenCalled();
  });

  it('a push failure on the RE-OPEN branch never fails the write either', async () => {
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({
        ...submittedTimesheet,
        id: 'ts-approved',
        status: 'approved',
      })),
    });
    const { svc } = makeService({
      timesheetRepo,
      push: makePush({
        notifyHouseholdParents: mock(() => {
          throw new Error('expo down');
        }),
      }),
    });

    const entry = (await clockOut(svc)) as { status: string };

    expect(entry.status).toBe('submitted');
    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts-approved',
      expect.objectContaining({ status: 'submitted', approved_by: null })
    );
  });
});

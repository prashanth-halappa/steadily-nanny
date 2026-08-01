import { describe, expect, it, mock } from 'bun:test';
import {
  AlreadyClockedInError,
  NotACarerError,
  NotATimesheetParentError,
  TimeEntryNotRunningError,
  TimesheetNotActionableError,
} from '../../../../../src/domains/timesheet/errors/timesheetErrors';
import {
  computeWorkedMinutes,
  TimesheetCommandService,
} from '../../../../../src/domains/timesheet/services/timesheetCommandService';

const runningEntry = {
  id: 't1',
  household_id: 'h1',
  carer_id: 'carer-1',
  shift_id: 's1',
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

const shift = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T08:00:00.000Z',
  ends_at: '2026-08-03T16:00:00.000Z', // 8h scheduled
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
};

const timesheet = {
  id: 'ts1',
  household_id: 'h1',
  carer_id: 'carer-1',
  week_start: '2026-08-03',
  total_minutes: 480,
  status: 'submitted',
  approved_by: null,
  approved_at: null,
  query_note: null,
  created_at: 't',
  updated_at: 't',
};

const household = { id: 'h1', timezone: 'Europe/London' };

function makeTimeEntryRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findRunningForCarer: mock(async () => null),
    clockIn: mock(async () => ({ ...runningEntry })),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      ...runningEntry,
      ...patch,
    })),
    ...overrides,
  };
}

function makeTimesheetRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByWeek: mock(async () => null),
    create: mock(async (data: Record<string, unknown>) => ({
      ...timesheet,
      ...data,
    })),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      ...timesheet,
      ...patch,
    })),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'carer-1',
      role: 'nanny',
    })),
    ...overrides,
  };
}

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => household),
    ...overrides,
  };
}

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => shift),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwnedTimeEntry: mock(async () => runningEntry),
    getOwnedTimesheet: mock(async () => timesheet),
    ...overrides,
  };
}

describe('computeWorkedMinutes', () => {
  it('subtracts break minutes from the clocked span', () => {
    expect(
      computeWorkedMinutes(
        '2026-08-03T08:00:00.000Z',
        '2026-08-03T16:00:00.000Z',
        30
      )
    ).toBe(450); // 8h - 30min
  });

  it('never goes negative even if breaks exceed the clocked span', () => {
    expect(
      computeWorkedMinutes(
        '2026-08-03T08:00:00.000Z',
        '2026-08-03T08:10:00.000Z',
        60
      )
    ).toBe(0);
  });
});

describe('TimesheetCommandService.clockIn', () => {
  it('creates a running entry for an active carer with no open entry', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries()
    );

    await svc.clockIn('carer-1', { household_id: 'h1', shift_id: 's1' });

    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        carer_id: 'carer-1',
        shift_id: 's1',
        timezone: 'Europe/London',
        kind: 'worked',
        status: 'running',
      })
    );
  });

  it('rejects with AlreadyClockedInError when a running entry already exists', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      findRunningForCarer: mock(async () => runningEntry),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries()
    );

    await expect(
      svc.clockIn('carer-1', { household_id: 'h1' })
    ).rejects.toBeInstanceOf(AlreadyClockedInError);
    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });

  it('rejects a non-carer (e.g. a parent) trying to clock in', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm2',
          household_id: 'h1',
          user_id: 'parent-1',
          role: 'parent',
        })),
      }),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries()
    );

    await expect(
      svc.clockIn('parent-1', { household_id: 'h1' })
    ).rejects.toBeInstanceOf(NotACarerError);
    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });
});

describe('TimesheetCommandService.clockOut', () => {
  it('freezes scheduled_minutes from the linked shift, submits, and creates a new week timesheet', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries()
    );

    await svc.clockOut('carer-1', 't1', { break_minutes: 30 });

    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        scheduled_minutes: 480, // 8h shift
        break_minutes: 30,
        status: 'submitted',
      })
    );
    expect(timesheetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        carer_id: 'carer-1',
        week_start: '2026-08-03', // Monday
      })
    );
  });

  it('adds to an existing week timesheet rather than creating a second one', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => timesheet),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries()
    );

    await svc.clockOut('carer-1', 't1', {});

    expect(timesheetRepo.create).not.toHaveBeenCalled();
    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({ total_minutes: expect.any(Number) })
    );
  });

  it('rejects clocking out an entry that is not running', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimeEntry: mock(async () => ({
          ...runningEntry,
          status: 'submitted',
        })),
      })
    );

    await expect(svc.clockOut('carer-1', 't1', {})).rejects.toBeInstanceOf(
      TimeEntryNotRunningError
    );
    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });
});

describe('TimesheetCommandService.approve', () => {
  it('approves a submitted timesheet as a parent', async () => {
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm3',
          household_id: 'h1',
          user_id: 'parent-1',
          role: 'parent',
        })),
      }),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries()
    );

    await svc.approve('parent-1', 'ts1');

    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({ status: 'approved', approved_by: 'parent-1' })
    );
  });

  it('rejects a carer (non-parent) trying to approve', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries()
    );

    await expect(svc.approve('carer-1', 'ts1')).rejects.toBeInstanceOf(
      NotATimesheetParentError
    );
  });

  it('rejects approving a timesheet with nothing submitted', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm3',
          household_id: 'h1',
          user_id: 'parent-1',
          role: 'parent',
        })),
      }),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => ({ ...timesheet, status: 'open' })),
      })
    );

    await expect(svc.approve('parent-1', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotActionableError
    );
  });
});

describe('TimesheetCommandService.query', () => {
  it('queries a submitted timesheet with a note', async () => {
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm3',
          household_id: 'h1',
          user_id: 'parent-1',
          role: 'parent',
        })),
      }),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries()
    );

    await svc.query('parent-1', 'ts1', { note: 'Query Thursday' });

    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({
        status: 'queried',
        query_note: 'Query Thursday',
      })
    );
  });
});

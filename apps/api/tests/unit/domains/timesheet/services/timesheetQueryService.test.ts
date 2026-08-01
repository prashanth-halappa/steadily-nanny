import { describe, expect, it, mock } from 'bun:test';
import {
  TimeEntryNotFoundError,
  TimesheetNotFoundError,
} from '../../../../../src/domains/timesheet/errors/timesheetErrors';
import { TimesheetQueryService } from '../../../../../src/domains/timesheet/services/timesheetQueryService';
import type {
  TimeEntry,
  Timesheet,
} from '../../../../../src/domains/timesheet/types';

const runningEntry: TimeEntry = {
  id: 't1',
  household_id: 'h1',
  carer_id: 'carer-1',
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

const timesheet: Timesheet = {
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

const membership = {
  id: 'm1',
  household_id: 'h1',
  user_id: 'u1',
  role: 'parent',
};

const household = { id: 'h1', timezone: 'Europe/London' };

function makeTimeEntryRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findRunningForCarer: mock(async () => runningEntry),
    findById: mock(async () => runningEntry),
    listForHouseholdWeek: mock(async () => [runningEntry]),
    ...overrides,
  };
}

function makeTimesheetRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => timesheet),
    listForHousehold: mock(async () => [timesheet]),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => membership),
    ...overrides,
  };
}

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => household),
    ...overrides,
  };
}

describe('TimesheetQueryService.getRunning', () => {
  it("returns the caller's running entry", async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.getRunning('carer-1')).toEqual(runningEntry);
  });

  it('returns null when nothing is running', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo({ findRunningForCarer: mock(async () => null) }),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.getRunning('carer-1')).toBeNull();
  });
});

describe('TimesheetQueryService.getOwnedTimeEntry', () => {
  it('returns the entry when it belongs to the caller', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.getOwnedTimeEntry('carer-1', 't1')).toEqual(runningEntry);
  });

  it("throws TimeEntryNotFoundError for someone else's entry (no existence leak)", async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    await expect(
      svc.getOwnedTimeEntry('someone-else', 't1')
    ).rejects.toBeInstanceOf(TimeEntryNotFoundError);
  });

  it('throws the SAME error for a truly missing entry', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo({ findById: mock(async () => null) }),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    await expect(
      svc.getOwnedTimeEntry('carer-1', 'missing')
    ).rejects.toBeInstanceOf(TimeEntryNotFoundError);
  });
});

describe('TimesheetQueryService.listForHouseholdWeek', () => {
  it('uses the given week_start when provided', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetQueryService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    await svc.listForHouseholdWeek('u1', 'h1', '2026-08-03');
    expect(timeEntryRepo.listForHouseholdWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10'
    );
  });

  it('throws for a non-member', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeHouseholdRepo()
    );
    await expect(
      svc.listForHouseholdWeek('u2', 'h1', '2026-08-03')
    ).rejects.toThrow();
  });
});

describe('TimesheetQueryService.getOwnedTimesheet', () => {
  it('returns the timesheet for an active household member', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.getOwnedTimesheet('u1', 'ts1')).toEqual(timesheet);
  });

  it('throws TimesheetNotFoundError for a non-member (no existence leak)', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeHouseholdRepo()
    );
    await expect(svc.getOwnedTimesheet('u2', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotFoundError
    );
  });
});

describe('TimesheetQueryService.listTimesheetsForHousehold', () => {
  it('lists once membership is confirmed', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.listTimesheetsForHousehold('u1', 'h1')).toEqual([
      timesheet,
    ]);
  });
});

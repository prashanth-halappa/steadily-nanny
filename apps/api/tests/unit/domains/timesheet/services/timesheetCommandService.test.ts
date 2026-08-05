import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { WeekEarnings } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { ShiftNotFoundError } from '../../../../../src/domains/shift';
import {
  AlreadyClockedInError,
  CancellationPaidAlreadyRecordedError,
  InvalidClockTimesError,
  NotACarerError,
  NotATimesheetParentError,
  TimeEntryNotEditableError,
  TimeEntryNotRunningError,
  TimeEntryOverlapError,
  TimesheetNotActionableError,
} from '../../../../../src/domains/timesheet/errors/timesheetErrors';
import {
  computeWorkedMinutes,
  recordCancellationPaidEntry,
  sumWorkedMinutes,
  TimesheetCommandService,
} from '../../../../../src/domains/timesheet/services/timesheetCommandService';

const runningEntry = {
  id: 't1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
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

const household = { id: 'h1', timezone: 'Europe/London' };

function makeTimeEntryRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findRunningForCarer: mock(async () => null),
    clockIn: mock(async () => ({ ...runningEntry })),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      ...runningEntry,
      ...patch,
    })),
    // Default empty — tests exercising the roll-up's total override this
    // with a fixed, known set of finished entries.
    listForCarerWeek: mock(async () => []),
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
    // Empty by default — a test that wants auto-match to find a candidate
    // must say so explicitly, so "no match" is never accidental.
    findByHouseholdAndRange: mock(async () => []),
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

function makeUserService(overrides: Record<string, unknown> = {}): any {
  return {
    getProfileById: mock(async () => ({
      user_id: 'carer-1',
      name: 'Nia Rowe',
    })),
    ...overrides,
  };
}

function makePush(overrides: Record<string, unknown> = {}): any {
  return {
    notifyUser: mock(() => undefined),
    notifyHouseholdParents: mock(() => undefined),
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

describe('sumWorkedMinutes', () => {
  it('sums computeWorkedMinutes across every finished entry, not just one', () => {
    const entries = [
      {
        clock_in_at: '2026-08-03T08:00:00.000Z',
        clock_out_at: '2026-08-03T16:00:00.000Z', // 480 min
        break_minutes: 0,
      },
      {
        clock_in_at: '2026-08-05T08:00:00.000Z',
        clock_out_at: '2026-08-05T13:30:00.000Z', // 330 min - 30 break = 300
        break_minutes: 30,
      },
    ];
    expect(sumWorkedMinutes(entries as any)).toBe(780);
  });

  it('is idempotent: summing the same fixed list twice yields the same total', () => {
    const entries = [
      {
        clock_in_at: '2026-08-03T08:00:00.000Z',
        clock_out_at: '2026-08-03T16:00:00.000Z',
        break_minutes: 0,
      },
    ];
    expect(sumWorkedMinutes(entries as any)).toBe(480);
    expect(sumWorkedMinutes(entries as any)).toBe(480);
  });

  it('skips a still-running entry (no clock_out_at) rather than throwing', () => {
    const entries = [
      {
        clock_in_at: '2026-08-03T08:00:00.000Z',
        clock_out_at: '2026-08-03T16:00:00.000Z',
        break_minutes: 0,
      },
      {
        clock_in_at: '2026-08-06T08:00:00.000Z',
        clock_out_at: null,
        break_minutes: 0,
      },
    ];
    expect(sumWorkedMinutes(entries as any)).toBe(480);
  });

  it('returns 0 for an empty week', () => {
    expect(sumWorkedMinutes([])).toBe(0);
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
      makeQueries(),
      makeUserService()
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

  // Regression coverage for the payroll-preservation fix
  // (033_preserve_payroll_on_carer_deletion.sql): carer_display_name must be
  // snapshotted at INSERT time, not left for a later read to derive from a
  // profile that may since have been deleted.
  it('snapshots the carer_display_name from the profile at clock-in time', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const userService = makeUserService({
      getProfileById: mock(async () => ({
        user_id: 'carer-1',
        name: 'Nia Rowe',
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      userService
    );

    await svc.clockIn('carer-1', { household_id: 'h1', shift_id: 's1' });

    expect(userService.getProfileById).toHaveBeenCalledWith('carer-1');
    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ carer_display_name: 'Nia Rowe' })
    );
  });

  it('falls back to a placeholder carer_display_name when the profile has no name set', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const userService = makeUserService({
      getProfileById: mock(async () => ({ user_id: 'carer-1', name: null })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      userService
    );

    await svc.clockIn('carer-1', { household_id: 'h1', shift_id: 's1' });

    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ carer_display_name: 'Carer' })
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
      makeQueries(),
      makeUserService()
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
      makeQueries(),
      makeUserService()
    );

    await expect(
      svc.clockIn('parent-1', { household_id: 'h1' })
    ).rejects.toBeInstanceOf(NotACarerError);
    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });

  // SECURITY: `shift_id` is a client-supplied uuid with no ownership check —
  // without this, a carer could attach a clock-in to ANY shift in the
  // system, including one in a DIFFERENT household. Beyond a bogus
  // scheduled_minutes on their own entry, this is a cross-household
  // integrity hole: `scheduleMaterialisationService` treats any shift with a
  // time_entries row as permanently un-touchable ("past and paid-for
  // reality is immutable"), so this could pin a stranger's shift shut.
  it('rejects a shift_id that belongs to a DIFFERENT household than the one clocked into', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo({
      findById: mock(async () => ({ ...shift, household_id: 'h2' })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      shiftRepo,
      makeQueries(),
      makeUserService()
    );

    await expect(
      svc.clockIn('carer-1', { household_id: 'h1', shift_id: 's1' })
    ).rejects.toBeInstanceOf(ShiftNotFoundError);
    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });

  it('rejects a shift_id assigned to a DIFFERENT carer in the SAME household', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo({
      findById: mock(async () => ({ ...shift, carer_id: 'other-carer' })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      shiftRepo,
      makeQueries(),
      makeUserService()
    );

    await expect(
      svc.clockIn('carer-1', { household_id: 'h1', shift_id: 's1' })
    ).rejects.toBeInstanceOf(ShiftNotFoundError);
    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });

  it('rejects a shift_id that does not exist at all', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo({ findById: mock(async () => null) });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      shiftRepo,
      makeQueries(),
      makeUserService()
    );

    await expect(
      svc.clockIn('carer-1', { household_id: 'h1', shift_id: 'missing' })
    ).rejects.toBeInstanceOf(ShiftNotFoundError);
    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });

  it('never calls the ownership check (findById) for an ad-hoc clock-in — it attempts auto-match instead', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo(); // default: findByHouseholdAndRange -> []
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      shiftRepo,
      makeQueries(),
      makeUserService()
    );

    await svc.clockIn('carer-1', { household_id: 'h1' });

    expect(shiftRepo.findById).not.toHaveBeenCalled();
    expect(shiftRepo.findByHouseholdAndRange).toHaveBeenCalled();
    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: null })
    );
  });
});

// The seeded confirmed shift this suite reasons against, matching the real
// fixture used for device/manual verification: id cc667c55-d795-4666-9950-
// ca3450632a18, 08:00-17:00 Europe/London, household 5d4b0b70-edd9-4218-
// b7df-a28d234f7e06, carer fd50487c-f94c-4568-b2e5-8836e407886c.
const seededShift = {
  ...shift,
  id: 'cc667c55-d795-4666-9950-ca3450632a18',
  household_id: '5d4b0b70-edd9-4218-b7df-a28d234f7e06',
  carer_id: 'fd50487c-f94c-4568-b2e5-8836e407886c',
  starts_at: '2026-08-03T07:00:00.000Z', // 08:00 Europe/London (BST, UTC+1)
  ends_at: '2026-08-03T16:00:00.000Z', // 17:00 Europe/London
};

/** The instant used across the auto-match suite: 07:40 UTC on the seeded shift's day, 20 min before its 08:00 Europe/London start. */
const clockInInstant = new Date('2026-08-03T07:40:00.000Z');

function makeAutoMatchService(
  timeEntryRepo: ReturnType<typeof makeTimeEntryRepo>,
  shiftRepo: ReturnType<typeof makeShiftRepo>
): TimesheetCommandService {
  return new TimesheetCommandService(
    timeEntryRepo,
    makeTimesheetRepo(),
    makeMemberRepo({
      findActiveMembership: mock(async () => ({
        id: 'm1',
        household_id: seededShift.household_id,
        user_id: seededShift.carer_id,
        role: 'nanny',
      })),
    }),
    makeHouseholdRepo(),
    shiftRepo,
    makeQueries(),
    makeUserService()
  );
}

describe('TimesheetCommandService.clockIn — auto-match to a confirmed shift', () => {
  it('matches a confirmed shift when the carer clocks in 20 minutes early (within the 2h tolerance)', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo({
      findByHouseholdAndRange: mock(async () => [seededShift]),
    });
    const svc = makeAutoMatchService(timeEntryRepo, shiftRepo);

    await svc.clockIn(
      seededShift.carer_id,
      { household_id: seededShift.household_id },
      () => clockInInstant
    );

    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: seededShift.id })
    );
  });

  it('leaves shift_id null when the only shift in range belongs to a different carer', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo({
      findByHouseholdAndRange: mock(async () => [
        { ...seededShift, carer_id: 'someone-else' },
      ]),
    });
    const svc = makeAutoMatchService(timeEntryRepo, shiftRepo);

    await svc.clockIn(
      seededShift.carer_id,
      { household_id: seededShift.household_id },
      () => clockInInstant
    );

    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: null })
    );
  });

  it('leaves shift_id null when the only shift in range is not confirmed (e.g. pending)', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo({
      findByHouseholdAndRange: mock(async () => [
        { ...seededShift, status: 'pending' },
      ]),
    });
    const svc = makeAutoMatchService(timeEntryRepo, shiftRepo);

    await svc.clockIn(
      seededShift.carer_id,
      { household_id: seededShift.household_id },
      () => clockInInstant
    );

    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: null })
    );
  });

  it('leaves shift_id null (an ad-hoc clock-in is legitimate) when findByHouseholdAndRange returns nothing in range', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo(); // default: []
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      shiftRepo,
      makeQueries(),
      makeUserService()
    );

    await svc.clockIn('carer-1', { household_id: 'h1' });

    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: null })
    );
  });

  it('resolves multiple in-range confirmed candidates deterministically — picks the one whose start is nearest the clock-in instant', async () => {
    const instant = new Date('2026-08-03T07:50:00.000Z');
    const nearShift = {
      ...seededShift,
      id: 'near-shift',
      starts_at: '2026-08-03T08:00:00.000Z', // 10 min away
    };
    const farShift = {
      ...seededShift,
      id: 'far-shift',
      starts_at: '2026-08-03T09:30:00.000Z', // 100 min away
    };
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo({
      // Deliberately out of order — nearest-wins must not depend on array order.
      findByHouseholdAndRange: mock(async () => [farShift, nearShift]),
    });
    const svc = makeAutoMatchService(timeEntryRepo, shiftRepo);

    await svc.clockIn(
      seededShift.carer_id,
      { household_id: seededShift.household_id },
      () => instant
    );

    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: 'near-shift' })
    );
  });

  it('breaks an exact-distance tie deterministically by the earlier starts_at', async () => {
    const instant = new Date('2026-08-03T08:00:00.000Z');
    const earlierShift = {
      ...seededShift,
      id: 'earlier-shift',
      starts_at: '2026-08-03T07:30:00.000Z', // 30 min before instant
    };
    const laterShift = {
      ...seededShift,
      id: 'later-shift',
      starts_at: '2026-08-03T08:30:00.000Z', // 30 min after instant
    };
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo({
      findByHouseholdAndRange: mock(async () => [laterShift, earlierShift]),
    });
    const svc = makeAutoMatchService(timeEntryRepo, shiftRepo);

    await svc.clockIn(
      seededShift.carer_id,
      { household_id: seededShift.household_id },
      () => instant
    );

    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: 'earlier-shift' })
    );
  });

  it('does NOT match a shift more than the 2h tolerance away — clocking in at 22:00 never matches tomorrow 08:00', async () => {
    const instant = new Date('2026-08-02T22:00:00.000Z');
    const tomorrowShift = {
      ...seededShift,
      id: 'tomorrow-shift',
      starts_at: '2026-08-03T07:00:00.000Z', // 9h away — outside tolerance
      ends_at: '2026-08-03T16:00:00.000Z',
    };
    const timeEntryRepo = makeTimeEntryRepo();
    const shiftRepo = makeShiftRepo({
      // The repo call itself is scoped by the service's from/to window, so a
      // real DB would never return this shift — but even if it did (e.g. a
      // wider mock), the service still must not pick it.
      findByHouseholdAndRange: mock(async () => [tomorrowShift]),
    });
    const svc = makeAutoMatchService(timeEntryRepo, shiftRepo);

    await svc.clockIn(
      seededShift.carer_id,
      { household_id: seededShift.household_id },
      () => instant
    );

    expect(timeEntryRepo.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: null })
    );
    const [householdArg, from, to] =
      shiftRepo.findByHouseholdAndRange.mock.calls[0];
    expect(householdArg).toBe(seededShift.household_id);
    // The requested window must exclude the 07:00 next-day shift.
    expect(new Date(to).getTime()).toBeLessThan(
      new Date(tomorrowShift.starts_at).getTime()
    );
    expect(new Date(from).getTime()).toBe(
      instant.getTime() - 2 * 60 * 60 * 1000
    );
  });
});

// Fixed, known finished entries used to assert EXACT derived totals below —
// never `expect.any(Number)`, since the whole point of this suite is
// proving the total is a real sum, not just "a number".
// `id: 't1'` matches the running entry clockOut is finishing — assertNoOverlap
// excludes self via that id (same mechanism updateEntry uses).
const finishedEntryA = {
  id: 't1',
  clock_in_at: '2026-08-03T08:00:00.000Z',
  clock_out_at: '2026-08-03T16:00:00.000Z', // 480 min
  break_minutes: 30, // -> 450
};
const finishedEntryB = {
  clock_in_at: '2026-08-04T08:00:00.000Z',
  clock_out_at: '2026-08-04T13:00:00.000Z', // 300 min
  break_minutes: 0, // -> 300
};
const finishedEntryC = {
  clock_in_at: '2026-08-05T08:00:00.000Z',
  clock_out_at: '2026-08-05T09:00:00.000Z', // 60 min
  break_minutes: 0, // -> 60
};

describe('TimesheetCommandService.clockOut', () => {
  it('freezes scheduled_minutes from the linked shift, submits, and creates a new week timesheet with the derived total', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      break_minutes: 30,
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

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
        carer_display_name: 'Nia Rowe',
        week_start: '2026-08-03', // Monday
        total_minutes: 450, // sumWorkedMinutes([finishedEntryA])
        status: 'submitted',
      })
    );
  });

  // Regression coverage for the payroll-preservation fix
  // (033_preserve_payroll_on_carer_deletion.sql): the new timesheet's
  // carer_display_name must come from the time entry's OWN frozen snapshot
  // (taken at clock-in), never re-resolved from the live profile — that's
  // what keeps the record legible after the carer's account is deleted.
  it('carries the time entry own carer_display_name snapshot onto a newly created timesheet, not a freshly re-resolved one', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...runningEntry,
        ...patch,
        carer_display_name: 'Frozen At Clock-In',
      })),
    });
    const timesheetRepo = makeTimesheetRepo();
    const userService = makeUserService({
      // Deliberately different from the entry's snapshot — proves the
      // roll-up never calls back out to the live profile.
      getProfileById: mock(async () => ({
        user_id: 'carer-1',
        name: 'Renamed Since',
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      userService
    );

    await svc.clockOut('carer-1', 't1', {
      break_minutes: 30,
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(userService.getProfileById).not.toHaveBeenCalled();
    expect(timesheetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ carer_display_name: 'Frozen At Clock-In' })
    );
  });

  it('leaves scheduled_minutes null at clock-out for a genuinely ad-hoc entry (no matched shift)', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const shiftRepo = makeShiftRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      shiftRepo,
      makeQueries({
        getOwnedTimeEntry: mock(async () => ({
          ...runningEntry,
          shift_id: null,
        })),
      }),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      break_minutes: 30,
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    // No shift to freeze from, so freezeScheduledMinutes never even needs to
    // look one up.
    expect(shiftRepo.findById).not.toHaveBeenCalled();
    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        scheduled_minutes: null,
        status: 'submitted',
      })
    );
  });

  it('recalculates the FULL week sum from every entry, not an increment on the stale existing total', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA, finishedEntryB]),
    });
    const timesheetRepo = makeTimesheetRepo({
      // Deliberately wrong/stale total (999) — if the roll-up were still
      // incrementing this, the result would be 999 + something. A correct
      // derived roll-up ignores it entirely and computes 450 + 300 = 750.
      findByWeek: mock(async () => ({ ...timesheet, total_minutes: 999 })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.create).not.toHaveBeenCalled();
    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({ total_minutes: 750 })
    );
  });

  it('reflects ALL of the week entries in the total, not just the newest one', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [
        finishedEntryA,
        finishedEntryB,
        finishedEntryC,
      ]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => null),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ total_minutes: 810 }) // 450 + 300 + 60
    );
  });

  it('is idempotent: two roll-ups over the SAME set of week entries produce the SAME total, not a doubled one', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      // Static — always returns the same single entry, regardless of how
      // many times the roll-up queries it. Simulates a retried/duplicated/
      // replayed clock-out re-running the roll-up for entries already on
      // disk.
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, total_minutes: 450 })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });
    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.update).toHaveBeenCalledTimes(2);
    for (const call of timesheetRepo.update.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ total_minutes: 450 }));
    }
  });

  it('recalculates in place when the existing week timesheet is still open', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'open' })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({
        total_minutes: 450,
        status: 'submitted',
      })
    );
  });

  it('re-opens an approved timesheet, clears its approval, AND sets the freshly derived total when new hours land on it', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA, finishedEntryB]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({
        ...timesheet,
        status: 'approved',
        approved_by: 'parent-1',
        approved_at: '2026-08-01T20:28:24.000Z',
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({
        total_minutes: 750,
        status: 'submitted',
        approved_by: null,
        approved_at: null,
      })
    );
  });

  it('re-opens a queried timesheet and clears its approval when new hours land on it', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({
        ...timesheet,
        status: 'queried',
        query_note: 'Query Thursday',
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({
        total_minutes: 450,
        status: 'submitted',
        approved_by: null,
        approved_at: null,
      })
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
      }),
      makeUserService()
    );

    await expect(
      svc.clockOut('carer-1', 't1', {
        clock_out_at: '2026-08-03T16:00:00.000Z',
      })
    ).rejects.toBeInstanceOf(TimeEntryNotRunningError);
    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });
});

describe('TimesheetCommandService.approve', () => {
  it('approves a submitted timesheet as a parent', async () => {
    // The status flip now travels inside the conditional write that also
    // freezes the earnings snapshot — see the "freezing the earnings
    // snapshot" block below for the full contract.
    const timesheetRepo = makeTimesheetRepo({
      approveSubmittedWithEarnings: mock(
        async (_id: string, patch: Record<string, unknown>) => ({
          ...timesheet,
          status: 'approved',
          ...patch,
        })
      ),
    });
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
      makeQueries(),
      makeUserService(),
      makePush(),
      {
        computeForWeek: mock(
          async (): Promise<WeekEarnings> => ({
            status: 'no_arrangement',
            week_start: '2026-08-03',
            unpriced_dates: [],
          })
        ),
      }
    );

    const approved = await svc.approve('parent-1', 'ts1');

    expect(approved.status).toBe('approved');
    expect(timesheetRepo.approveSubmittedWithEarnings).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({ approved_by: 'parent-1' }),
      // The row version the earnings were computed from — see the
      // "CAS carries the row version" block below.
      timesheet.updated_at
    );
  });

  it('rejects a carer (non-parent) trying to approve', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
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
      }),
      makeUserService()
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
      makeQueries(),
      makeUserService()
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

  it('pushes the carer once with TIMESHEET_QUERIED when a week is queried', async () => {
    const push = makePush();
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
      makeQueries(),
      makeUserService(),
      push
    );

    await svc.query('parent-1', 'ts1', { note: 'Query Thursday' });

    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    expect(push.notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERIED,
          timesheetId: 'ts1',
          householdId: 'h1',
          weekStart: '2026-08-03',
        }),
      })
    );
  });

  it('still returns the queried timesheet when the carer push throws', async () => {
    const push = makePush({
      notifyUser: mock(() => {
        throw new Error('expo down');
      }),
    });
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
      makeQueries(),
      makeUserService(),
      push
    );

    const result = await svc.query('parent-1', 'ts1', {
      note: 'Query Thursday',
    });

    expect(result.status).toBe('queried');
    expect(timesheetRepo.update).toHaveBeenCalled();
  });
});

// A clocked-out entry — the only state a correction can act on. Same week
// (Monday 2026-08-03, Europe/London) as `timesheet` above.
const submittedEntry = {
  ...runningEntry,
  clock_out_at: '2026-08-03T16:00:00.000Z',
  break_minutes: 30,
  scheduled_minutes: 480,
  status: 'submitted',
};

describe('TimesheetCommandService.clockOut — supplied clock_out_at (#7)', () => {
  it('records the supplied finish rather than the server clock, so a forgotten clock-out does not bank idle hours', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ clock_out_at: '2026-08-03T16:00:00.000Z' })
    );
  });

  it('rejects a finish at or before the clock-in', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await expect(
      svc.clockOut('carer-1', 't1', {
        clock_out_at: '2026-08-03T07:00:00.000Z', // before the 08:00 clock-in
      })
    ).rejects.toBeInstanceOf(InvalidClockTimesError);
  });

  it('rejects a finish in the future — a carer may move a finish earlier, never invent hours', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await expect(
      svc.clockOut('carer-1', 't1', { clock_out_at: tomorrow })
    ).rejects.toBeInstanceOf(InvalidClockTimesError);
  });
});

describe('TimesheetCommandService.updateEntry (P0-2)', () => {
  function makeEditableSvc(
    overrides: {
      timeEntryRepo?: any;
      timesheetRepo?: any;
      entry?: Record<string, unknown>;
    } = {}
  ) {
    return new TimesheetCommandService(
      overrides.timeEntryRepo ??
        makeTimeEntryRepo({
          // Include the entry's own id so assertNoOverlap can exclude self.
          listForCarerWeek: mock(async () => [{ ...finishedEntryA, id: 't1' }]),
          update: mock(async (_id: string, patch: Record<string, unknown>) => ({
            ...submittedEntry,
            ...patch,
          })),
        }),
      overrides.timesheetRepo ??
        makeTimesheetRepo({
          findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
        }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimeEntry: mock(async () => overrides.entry ?? submittedEntry),
      }),
      makeUserService()
    );
  }

  it('applies the correction and re-derives the week total from the corrected entries', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      // The week as it stands AFTER the correction — the roll-up derives
      // from this list rather than adjusting a stored total. Same list is
      // also the overlap check's view; id 't1' matches the edited row so
      // self is excluded.
      listForCarerWeek: mock(async () => [
        { ...finishedEntryA, id: 't1', break_minutes: 0 }, // 480, was 450
      ]),
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...submittedEntry,
        ...patch,
      })),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });
    const svc = makeEditableSvc({ timeEntryRepo, timesheetRepo });

    await svc.updateEntry('carer-1', 't1', { break_minutes: 0 });

    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ break_minutes: 0 })
    );
    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({ total_minutes: 480, status: 'submitted' })
    );
  });

  it('leaves untouched fields alone — an omitted field is not a null', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [{ ...finishedEntryA, id: 't1' }]),
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...submittedEntry,
        ...patch,
      })),
    });
    const svc = makeEditableSvc({ timeEntryRepo });

    await svc.updateEntry('carer-1', 't1', {
      clock_out_at: '2026-08-03T15:00:00.000Z',
    });

    const patch = timeEntryRepo.update.mock.calls[0][1];
    expect(patch).toEqual({ clock_out_at: '2026-08-03T15:00:00.000Z' });
  });

  it('refuses to edit a running entry — clocking out is its edit', async () => {
    const svc = makeEditableSvc({ entry: runningEntry });

    await expect(
      svc.updateEntry('carer-1', 't1', { break_minutes: 15 })
    ).rejects.toBeInstanceOf(TimeEntryNotEditableError);
  });

  it('refuses to edit a week the parent has already approved', async () => {
    const svc = makeEditableSvc({
      timesheetRepo: makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'approved' })),
      }),
    });

    await expect(
      svc.updateEntry('carer-1', 't1', { break_minutes: 15 })
    ).rejects.toBeInstanceOf(TimeEntryNotEditableError);
  });

  it('rejects a clock-in edit that moves the entry into a different week', async () => {
    const svc = makeEditableSvc();

    await expect(
      // Sunday 2 Aug in Europe/London — the previous week.
      svc.updateEntry('carer-1', 't1', {
        clock_in_at: '2026-08-02T12:00:00.000Z',
      })
    ).rejects.toBeInstanceOf(InvalidClockTimesError);
  });

  it('rejects a correction whose finish lands before its start', async () => {
    const svc = makeEditableSvc();

    await expect(
      svc.updateEntry('carer-1', 't1', {
        clock_out_at: '2026-08-03T07:00:00.000Z',
      })
    ).rejects.toBeInstanceOf(InvalidClockTimesError);
  });

  it('rejects a clock-out edit that finishes in the following week', async () => {
    // Entry already sits on the last Sunday of its week so a short overnight
    // finish can cross Monday without tripping the 16h span ceiling — and
    // both ends are in the past so CLOCK_OUT_IN_FUTURE cannot fire first.
    const sundayEntry = {
      ...submittedEntry,
      clock_in_at: '2026-07-26T10:00:00.000Z',
      clock_out_at: '2026-07-26T16:00:00.000Z',
      local_date: '2026-07-26',
    };
    const svc = makeEditableSvc({
      entry: sundayEntry,
      timeEntryRepo: makeTimeEntryRepo({
        listForCarerWeek: mock(async () => [{ ...sundayEntry, id: 't1' }]),
        update: mock(async (_id: string, patch: Record<string, unknown>) => ({
          ...sundayEntry,
          ...patch,
        })),
      }),
      timesheetRepo: makeTimesheetRepo({
        findByWeek: mock(async () => ({
          ...timesheet,
          week_start: '2026-07-20',
          status: 'submitted',
        })),
      }),
    });

    // Sunday evening → Monday morning in Europe/London: clock-in stays in
    // the original week (Mon 20 Jul), finish lands in the next.
    await expect(
      svc.updateEntry('carer-1', 't1', {
        clock_in_at: '2026-07-26T20:00:00.000Z',
        clock_out_at: '2026-07-27T07:00:00.000Z',
      })
    ).rejects.toBeInstanceOf(InvalidClockTimesError);
  });
});

describe('TimesheetCommandService.createRetroactiveEntry', () => {
  // Same week as `timesheet` (Mon 2026-08-03), clearly in the past so
  // assertClockOrder's future bound never flakes on wall-clock drift.
  // Starts at finishedEntryA's finish (16:00) — touching end-to-start is
  // allowed; overlapping 08:00–16:00 is not.
  const retroInput = {
    household_id: 'h1',
    clock_in_at: '2026-08-03T16:00:00.000Z',
    clock_out_at: '2026-08-04T00:00:00.000Z', // 480 min
    break_minutes: 30, // -> 450
  };

  const createdRetroEntry = {
    ...submittedEntry,
    id: 't-retro',
    clock_in_at: retroInput.clock_in_at,
    clock_out_at: retroInput.clock_out_at,
    break_minutes: 30,
    shift_id: null,
    status: 'submitted',
    kind: 'worked',
  };

  /** Overlap check runs before create; roll-up after — two distinct views. */
  function listForCarerWeekCreateThenRollup(afterCreate: unknown[]) {
    let calls = 0;
    return mock(async () => {
      calls += 1;
      return calls === 1 ? [finishedEntryA] : afterCreate;
    });
  }

  function makeRetroSvc(
    overrides: {
      timeEntryRepo?: any;
      timesheetRepo?: any;
      shiftRepo?: any;
    } = {}
  ) {
    const created = {
      ...createdRetroEntry,
      ...(overrides.timeEntryRepo ? {} : {}),
    };
    return new TimesheetCommandService(
      overrides.timeEntryRepo ??
        makeTimeEntryRepo({
          createSubmitted: mock(async (data: Record<string, unknown>) => ({
            ...created,
            ...data,
          })),
          listForCarerWeek: listForCarerWeekCreateThenRollup([
            finishedEntryA,
            {
              clock_in_at: retroInput.clock_in_at,
              clock_out_at: retroInput.clock_out_at,
              break_minutes: 30,
            },
          ]),
        }),
      overrides.timesheetRepo ??
        makeTimesheetRepo({
          findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
        }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      overrides.shiftRepo ?? makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );
  }

  it('lands submitted and rolls the entry into the week total', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...createdRetroEntry,
        ...data,
      })),
      // Week after create: prior finishedEntryA (450) + this retro (450) = 900
      listForCarerWeek: listForCarerWeekCreateThenRollup([
        finishedEntryA,
        {
          clock_in_at: retroInput.clock_in_at,
          clock_out_at: retroInput.clock_out_at,
          break_minutes: 30,
        },
      ]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });
    const svc = makeRetroSvc({ timeEntryRepo, timesheetRepo });

    const result = await svc.createRetroactiveEntry('carer-1', retroInput);

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        carer_id: 'carer-1',
        clock_in_at: retroInput.clock_in_at,
        clock_out_at: retroInput.clock_out_at,
        break_minutes: 30,
        kind: 'worked',
        status: 'submitted',
      })
    );
    expect(result.status).toBe('submitted');
    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({ total_minutes: 900, status: 'submitted' })
    );
  });

  it('rejects a session that crosses a week boundary', async () => {
    const svc = makeRetroSvc();

    await expect(
      svc.createRetroactiveEntry('carer-1', {
        household_id: 'h1',
        // Sunday evening → Monday morning in Europe/London (BST)
        clock_in_at: '2026-08-02T20:00:00.000Z',
        clock_out_at: '2026-08-03T08:00:00.000Z',
      })
    ).rejects.toBeInstanceOf(InvalidClockTimesError);
  });

  it('rejects creating an entry on a week the parent has already approved', async () => {
    const svc = makeRetroSvc({
      timesheetRepo: makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'approved' })),
      }),
    });

    await expect(
      svc.createRetroactiveEntry('carer-1', retroInput)
    ).rejects.toBeInstanceOf(TimeEntryNotEditableError);
  });

  it('creates a submitted entry even when a running entry already exists (does not violate one-running-entry)', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      findRunningForCarer: mock(async () => runningEntry),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...createdRetroEntry,
        ...data,
      })),
      listForCarerWeek: listForCarerWeekCreateThenRollup([
        {
          clock_in_at: retroInput.clock_in_at,
          clock_out_at: retroInput.clock_out_at,
          break_minutes: 30,
        },
      ]),
    });
    const svc = makeRetroSvc({ timeEntryRepo });

    await svc.createRetroactiveEntry('carer-1', retroInput);

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'submitted' })
    );
    // Must never attempt a running insert — that would hit the unique index.
    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });
});

describe('recordCancellationPaidEntry', () => {
  const paidShift = {
    id: 's1',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-03T09:00:00.000Z',
    ends_at: '2026-08-03T17:00:00.000Z', // 480 min
    timezone: 'Europe/London',
    cancellation_paid: true,
  };

  const cancellationEntry = {
    ...submittedEntry,
    id: 't-cancel',
    shift_id: 's1',
    clock_in_at: paidShift.starts_at,
    clock_out_at: paidShift.ends_at,
    break_minutes: 0,
    scheduled_minutes: 480,
    kind: 'cancellation_paid',
    status: 'submitted',
  };

  function makeCancelSvc(
    timeEntryRepo: any,
    timesheetRepo: any = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    })
  ) {
    return new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );
  }

  it('creates exactly one cancellation_paid entry and rolls it into the week total', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => null),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...cancellationEntry,
        ...data,
      })),
      listForCarerWeek: mock(async () => [
        finishedEntryA,
        {
          clock_in_at: paidShift.starts_at,
          clock_out_at: paidShift.ends_at,
          break_minutes: 0,
        },
      ]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });
    const svc = makeCancelSvc(timeEntryRepo, timesheetRepo);

    const result = await svc.recordCancellationPaidEntry(paidShift);

    expect(result?.kind).toBe('cancellation_paid');
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledTimes(1);
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        shift_id: 's1',
        kind: 'cancellation_paid',
        status: 'submitted',
        clock_in_at: paidShift.starts_at,
        clock_out_at: paidShift.ends_at,
        scheduled_minutes: 480,
      })
    );
    // 450 (finishedEntryA) + 480 (cancellation) = 930
    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({ total_minutes: 930 })
    );
  });

  it('records a FUTURE paid-cancel shift (starts in 6h) — the production case', async () => {
    // assertClockOrder's CLOCK_OUT_IN_FUTURE bound must NOT apply here:
    // short-notice cancel accepts before the shift starts, so ends_at is
    // intentionally in the future. Only ends_at > starts_at is required.
    const startsAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString();
    const futureShift = {
      ...paidShift,
      starts_at: startsAt,
      ends_at: endsAt,
    };
    const futureEntry = {
      ...cancellationEntry,
      clock_in_at: startsAt,
      clock_out_at: endsAt,
      scheduled_minutes: 480,
    };
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => null),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...futureEntry,
        ...data,
      })),
      listForCarerWeek: mock(async () => [
        {
          clock_in_at: startsAt,
          clock_out_at: endsAt,
          break_minutes: 0,
        },
      ]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });
    const svc = makeCancelSvc(timeEntryRepo, timesheetRepo);

    const result = await svc.recordCancellationPaidEntry(futureShift);

    expect(result?.kind).toBe('cancellation_paid');
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'cancellation_paid',
        clock_in_at: startsAt,
        clock_out_at: endsAt,
        scheduled_minutes: 480,
      })
    );
  });

  it('is idempotent: a second call does not create another entry', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => cancellationEntry),
      createSubmitted: mock(async () => cancellationEntry),
      listForCarerWeek: mock(async () => [
        {
          clock_in_at: paidShift.starts_at,
          clock_out_at: paidShift.ends_at,
          break_minutes: 0,
        },
      ]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({
        ...timesheet,
        total_minutes: 480,
        status: 'submitted',
      })),
    });
    const svc = makeCancelSvc(timeEntryRepo, timesheetRepo);

    const first = await svc.recordCancellationPaidEntry(paidShift);
    const second = await svc.recordCancellationPaidEntry(paidShift);

    expect(first?.id).toBe('t-cancel');
    expect(second?.id).toBe('t-cancel');
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('stays at one row when a concurrent insert races past find-first (23505)', async () => {
    // Find-first is an optimisation only — the partial unique index is the
    // source of truth. Simulate the losing racer: pre-check miss, insert
    // hits 23505, re-fetch returns the winner's row.
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(cancellationEntry),
      createSubmitted: mock(async () => {
        throw new CancellationPaidAlreadyRecordedError('s1');
      }),
      listForCarerWeek: mock(async () => []),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });
    const svc = makeCancelSvc(timeEntryRepo, timesheetRepo);

    const result = await svc.recordCancellationPaidEntry(paidShift);

    expect(result?.id).toBe('t-cancel');
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledTimes(1);
    expect(timeEntryRepo.findCancellationPaidForShift).toHaveBeenCalledTimes(2);
    // Losing racer must not roll up again — the winner already did.
    expect(timesheetRepo.update).not.toHaveBeenCalled();
    expect(timesheetRepo.create).not.toHaveBeenCalled();
  });

  it('rejects recording on a week the parent has already approved', async () => {
    // Same policy as createRetroactiveEntry: block rather than insert and
    // let rollUpIntoTimesheet silently un-approve the week.
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => null),
      createSubmitted: mock(async () => cancellationEntry),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'approved' })),
    });
    const svc = makeCancelSvc(timeEntryRepo, timesheetRepo);

    await expect(
      svc.recordCancellationPaidEntry(paidShift)
    ).rejects.toBeInstanceOf(TimeEntryNotEditableError);
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('uses household timezone for the approved-week guard, not shift.timezone', async () => {
    // Instant is Monday in UTC / household TZ, but still Sunday in the
    // shift's America/Los_Angeles — wrong TZ would look up week 2026-07-27
    // and miss the approved 2026-08-03 timesheet.
    const divergentShift = {
      ...paidShift,
      starts_at: '2026-08-03T01:30:00.000Z',
      ends_at: '2026-08-03T09:30:00.000Z',
      timezone: 'America/Los_Angeles',
    };
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => null),
      createSubmitted: mock(async () => cancellationEntry),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(
        async (_hh: string, _carer: string, weekStart: string) =>
          weekStart === '2026-08-03'
            ? { ...timesheet, week_start: '2026-08-03', status: 'approved' }
            : null
      ),
    });
    const householdRepo = makeHouseholdRepo({
      findById: mock(async () => ({ id: 'h1', timezone: 'UTC' })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      householdRepo,
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );

    await expect(
      svc.recordCancellationPaidEntry(divergentShift)
    ).rejects.toBeInstanceOf(TimeEntryNotEditableError);
    expect(timesheetRepo.findByWeek).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-03'
    );
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('rejects when ends_at is not after starts_at', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => null),
      createSubmitted: mock(async () => cancellationEntry),
    });
    const svc = makeCancelSvc(timeEntryRepo);

    await expect(
      svc.recordCancellationPaidEntry({
        ...paidShift,
        ends_at: paidShift.starts_at,
      })
    ).rejects.toBeInstanceOf(InvalidClockTimesError);
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('no-ops when the shift is not cancellation_paid', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => null),
      createSubmitted: mock(async () => cancellationEntry),
    });
    const svc = makeCancelSvc(timeEntryRepo);

    const result = await svc.recordCancellationPaidEntry({
      ...paidShift,
      cancellation_paid: false,
    });

    expect(result).toBeNull();
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('exports a module-level helper the orchestrator can call', async () => {
    expect(typeof recordCancellationPaidEntry).toBe('function');
  });
});

// =============================================================================
// Approve: compute -> freeze -> flip, as ONE conditional update
// (TIER0-PLAN.md Phase 2 "Wiring", docs/11-MONEY.md §3, review finding 13).
// =============================================================================

const ARRANGEMENT_ID = '11111111-1111-4111-8111-111111111101';

const computedEarnings: WeekEarnings = {
  status: 'ok',
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [
    {
      kind: 'regular',
      minutes: 480,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 14_800,
      from_date: '2026-08-03',
      to_date: '2026-08-03',
      arrangement_id: ARRANGEMENT_ID,
    },
  ],
  gross_minor: 14_800,
  reimbursements_minor: 0,
  worked_minutes: 480,
  payable_minutes: 480,
  guaranteed_minutes_per_week: null,
};

function makeEarnings(overrides: Record<string, unknown> = {}): any {
  return {
    computeForWeek: mock(async () => computedEarnings),
    ...overrides,
  };
}

function makeParentMemberRepo(): any {
  return makeMemberRepo({
    findActiveMembership: mock(async () => ({
      id: 'm3',
      household_id: 'h1',
      user_id: 'parent-1',
      role: 'parent',
    })),
  });
}

function makeApprovingRepo(overrides: Record<string, unknown> = {}): any {
  return makeTimesheetRepo({
    approveSubmittedWithEarnings: mock(
      async (_id: string, patch: Record<string, unknown>) => ({
        ...timesheet,
        status: 'approved',
        ...patch,
      })
    ),
    ...overrides,
  });
}

describe('TimesheetCommandService.approve — freezing the earnings snapshot', () => {
  it('computes the week, then writes all four snapshot columns AND the status flip in ONE conditional update', async () => {
    const timesheetRepo = makeApprovingRepo();
    const earnings = makeEarnings();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      earnings
    );

    await svc.approve('parent-1', 'ts1');

    expect(earnings.computeForWeek).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-03'
    );
    expect(timesheetRepo.approveSubmittedWithEarnings).toHaveBeenCalledTimes(1);
    const [id, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('ts1');
    expect(patch).toEqual({
      approved_by: 'parent-1',
      approved_at: expect.any(String),
      gross_minor: 14_800,
      currency: 'GBP',
      earnings: computedEarnings,
      earnings_computed_at: expect.any(String),
    });
    // The general-purpose update must NOT be used: it has no status
    // predicate, so it cannot be the write that approves a week.
    expect(timesheetRepo.update).not.toHaveBeenCalled();
  });

  it('stamps the approval and the snapshot with the SAME instant — one write, one moment', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      makeEarnings()
    );

    await svc.approve('parent-1', 'ts1');

    const [, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(patch.earnings_computed_at).toBe(patch.approved_at);
  });

  it('freezes exactly what was computed — a different engine result freezes differently', async () => {
    const other: WeekEarnings = {
      ...computedEarnings,
      status: 'ok',
      currency: 'EUR',
      lines: [],
      gross_minor: 99_900,
      reimbursements_minor: 0,
      worked_minutes: 480,
      payable_minutes: 480,
      guaranteed_minutes_per_week: null,
    };
    const timesheetRepo = makeApprovingRepo();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      makeEarnings({ computeForWeek: mock(async () => other) })
    );

    await svc.approve('parent-1', 'ts1');

    const [, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(patch.gross_minor).toBe(99_900);
    expect(patch.currency).toBe('EUR');
    expect(patch.earnings).toEqual(other);
  });

  it('freezes an unpriceable week as the no_arrangement arm, with no amount at all — never £0.00', async () => {
    const noArrangement: WeekEarnings = {
      status: 'no_arrangement',
      week_start: '2026-08-03',
      unpriced_dates: ['2026-08-03'],
    };
    const timesheetRepo = makeApprovingRepo();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      makeEarnings({ computeForWeek: mock(async () => noArrangement) })
    );

    await svc.approve('parent-1', 'ts1');

    const [, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(patch.gross_minor).toBeNull();
    expect(patch.currency).toBeNull();
    expect(patch.earnings).toEqual(noArrangement);
  });

  it('approves a departed carer’s week with an empty snapshot rather than inventing a figure', async () => {
    const timesheetRepo = makeApprovingRepo();
    const earnings = makeEarnings();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => ({ ...timesheet, carer_id: null })),
      }),
      makeUserService(),
      makePush(),
      earnings
    );

    await svc.approve('parent-1', 'ts1');

    expect(earnings.computeForWeek).not.toHaveBeenCalled();
    const [, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(patch).toMatchObject({
      gross_minor: null,
      currency: null,
      earnings: null,
      earnings_computed_at: null,
    });
  });

  it('LOSES THE RACE cleanly: status changed between read and write -> no snapshot, house-style error', async () => {
    // D1's surface with money attached: a clock-out roll-up re-opened the
    // week after `assertActionable` passed. The conditional update matches
    // zero rows, and the approve must fail exactly as a stale status does.
    const timesheetRepo = makeApprovingRepo({
      approveSubmittedWithEarnings: mock(async () => null),
    });
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      makeEarnings()
    );

    await expect(svc.approve('parent-1', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotActionableError
    );
    expect(timesheetRepo.update).not.toHaveBeenCalled();
    expect(timesheetRepo.approveSubmittedWithEarnings).toHaveBeenCalledTimes(1);
  });

  it('never computes or writes anything when the pre-check already rejects the status', async () => {
    const timesheetRepo = makeApprovingRepo();
    const earnings = makeEarnings();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => ({
          ...timesheet,
          status: 'approved',
        })),
      }),
      makeUserService(),
      makePush(),
      earnings
    );

    await expect(svc.approve('parent-1', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotActionableError
    );
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
    expect(timesheetRepo.approveSubmittedWithEarnings).not.toHaveBeenCalled();
  });

  it('never computes earnings for a non-parent — role first, money second', async () => {
    const earnings = makeEarnings();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeApprovingRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      earnings
    );

    await expect(svc.approve('carer-1', 'ts1')).rejects.toBeInstanceOf(
      NotATimesheetParentError
    );
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });
});

// =============================================================================
// The D1 reopen path, now with money: reverting the status must clear the
// snapshot in the SAME write (docs/11-MONEY.md §3, migration 042's header).
// =============================================================================

describe('TimesheetCommandService.rollUpIntoTimesheet — reopen clears the earnings snapshot (D1)', () => {
  it('nulls all four snapshot columns in the SAME update that reverts an approved week', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA, finishedEntryB]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({
        ...timesheet,
        status: 'approved',
        approved_by: 'parent-1',
        approved_at: '2026-08-01T20:28:24.000Z',
        gross_minor: 14_800,
        currency: 'GBP',
        earnings: computedEarnings,
        earnings_computed_at: '2026-08-01T20:28:24.000Z',
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.update).toHaveBeenCalledTimes(1);
    expect(timesheetRepo.update).toHaveBeenCalledWith('ts1', {
      total_minutes: 750,
      status: 'submitted',
      approved_by: null,
      approved_at: null,
      gross_minor: null,
      currency: null,
      earnings: null,
      earnings_computed_at: null,
    });
  });

  it('clears the snapshot when a QUERIED week reopens too', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({
        ...timesheet,
        status: 'queried',
        query_note: 'Query Thursday',
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({
        gross_minor: null,
        currency: null,
        earnings: null,
        earnings_computed_at: null,
      })
    );
  });

  it('writes the SAME cleared columns on an ordinary submitted-week roll-up', async () => {
    // This assertion used to be `{ total_minutes, status }` and nothing else,
    // on the reasoning that a submitted week has nothing to clear. Phase 2
    // review finding 1 is that the reasoning is a pre-read: an approve
    // landing between `findByWeek` and this update makes "nothing to clear"
    // false, and the branch had no way to know. The clear is now
    // unconditional — see the block below and the service's comment.
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.update).toHaveBeenCalledWith('ts1', {
      total_minutes: 450,
      status: 'submitted',
      approved_by: null,
      approved_at: null,
      gross_minor: null,
      currency: null,
      earnings: null,
      earnings_computed_at: null,
    });
  });
});

// =============================================================================
// Phase 2 review, finding 1 (SHIP-BLOCKER): the compute -> freeze CAS must be
// on the ROW VERSION, not on `status` alone.
//
// `rollUpIntoTimesheet` writes `total_minutes` on an already-`submitted` week
// WITHOUT changing `status`. A `where status = 'submitted'` predicate is blind
// to that write, so this interleaving freezes a lie:
//
//   parent approves        -> engine computes 20h / £370.00
//   nanny clocks out 8h    -> roll-up sets total_minutes = 28h, status unchanged
//   the CAS still matches  -> `approved`, 28h of hours, £370.00 frozen
//
// 28h signed off at a 20h price: the nanny is £148 short and the row looks
// perfectly consistent. The predicate has to carry the version the earnings
// were computed from (`docs/11-MONEY.md` §3, docs/DEFECT-LOG.md D1).
// =============================================================================

/** `updated_at` of the row `approve` reads before it computes anything. */
const VERSION_AT_READ = '2026-08-10T08:59:12.123456+00:00';
/** ...and what the trigger stamps once a concurrent roll-up has written. */
const VERSION_AFTER_ROLLUP = '2026-08-10T08:59:12.987654+00:00';

const submittedAtVersion = {
  ...timesheet,
  status: 'submitted',
  total_minutes: 1200, // 20h — what the parent is looking at
  updated_at: VERSION_AT_READ,
};

/**
 * A repo stub that HONOURS the compare-and-set the way Postgres would: the
 * update lands only if both the status and the version it was told to expect
 * still describe the row. `currentRow` is the live row the fake database
 * holds, so a test can mutate it to stage an interleaving.
 */
function makeCasHonouringRepo(currentRow: Record<string, unknown>): any {
  return makeTimesheetRepo({
    approveSubmittedWithEarnings: mock(
      async (
        _id: string,
        patch: Record<string, unknown>,
        expectedUpdatedAt: string
      ) => {
        // Postgres cannot be handed a predicate that isn't there. Failing
        // loudly stops "no version supplied" from LOOKING like a correctly
        // lost race in the test below.
        if (typeof expectedUpdatedAt !== 'string') {
          throw new Error(
            'approveSubmittedWithEarnings was called with no row version'
          );
        }
        return currentRow.status === 'submitted' &&
          currentRow.updated_at === expectedUpdatedAt
          ? { ...currentRow, status: 'approved', ...patch }
          : null;
      }
    ),
  });
}

describe('TimesheetCommandService.approve — the CAS carries the row version', () => {
  it('passes the `updated_at` of the row it read BEFORE computing into the conditional write', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => submittedAtVersion),
      }),
      makeUserService(),
      makePush(),
      makeEarnings()
    );

    await svc.approve('parent-1', 'ts1');

    expect(timesheetRepo.approveSubmittedWithEarnings).toHaveBeenCalledWith(
      'ts1',
      expect.any(Object),
      VERSION_AT_READ
    );
  });

  it('REFUSES to freeze when a roll-up bumped the hours without touching the status', async () => {
    // The live row a concurrent clock-out already rewrote: 28h now, still
    // `submitted`, so a status-only predicate would happily match it.
    const currentRow: Record<string, unknown> = {
      ...submittedAtVersion,
      total_minutes: 1680, // 28h
      updated_at: VERSION_AFTER_ROLLUP,
    };
    const timesheetRepo = makeCasHonouringRepo(currentRow);
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      // The parent's read happened before the roll-up landed.
      makeQueries({ getOwnedTimesheet: mock(async () => submittedAtVersion) }),
      makeUserService(),
      makePush(),
      makeEarnings()
    );

    await expect(svc.approve('parent-1', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotActionableError
    );
    // Nothing was written: no approval, and no frozen figure on 28h of hours.
    expect(currentRow.status).toBe('submitted');
    expect(currentRow.gross_minor).toBeUndefined();
  });

  it('still approves normally when nothing moved underneath it', async () => {
    const currentRow: Record<string, unknown> = { ...submittedAtVersion };
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeCasHonouringRepo(currentRow),
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({ getOwnedTimesheet: mock(async () => submittedAtVersion) }),
      makeUserService(),
      makePush(),
      makeEarnings()
    );

    const approved = await svc.approve('parent-1', 'ts1');

    expect(approved.status).toBe('approved');
    // The wire shape, not the frozen row — see the finding-6 block below.
    expect(approved).not.toHaveProperty('gross_minor');
  });
});

// =============================================================================
// The mirror of the same race (Phase 2 review, finding 1, second half).
//
// `rollUpIntoTimesheet` decides "am I reopening?" from a status it read
// BEFORE the write. If an approve lands in that window, the pre-read says
// `submitted`, the flag is false, and the write sets `status = 'submitted'`
// while leaving `gross_minor`/`earnings`/`approved_by` on the row: a
// `submitted` week wearing a frozen amount and an approval, which is exactly
// the invariant 042's header says these columns keep.
//
// Fix: the clear is UNCONDITIONAL. Every roll-up write sets `status =
// 'submitted'`, and a submitted row has no snapshot and no approver by
// definition, so writing the nulls is a restatement of the invariant rather
// than a branch that can be raced.
// =============================================================================

describe('TimesheetCommandService.rollUpIntoTimesheet — any revert to submitted clears the snapshot', () => {
  it('clears the snapshot even when the PRE-READ said submitted — the approve raced in behind it', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    // What the roll-up read: an ordinary submitted week. By the time it
    // writes, a parent has approved and frozen £370.00 onto this row.
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.update).toHaveBeenCalledWith('ts1', {
      total_minutes: 450,
      status: 'submitted',
      approved_by: null,
      approved_at: null,
      gross_minor: null,
      currency: null,
      earnings: null,
      earnings_computed_at: null,
    });
  });

  it('clears the snapshot on an OPEN week too — every write that lands on submitted does', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'open' })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({
        status: 'submitted',
        approved_by: null,
        approved_at: null,
        gross_minor: null,
        currency: null,
        earnings: null,
        earnings_computed_at: null,
      })
    );
  });

  it('still preserves query_note — the D1 rule that the disagreement survives', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({
        ...timesheet,
        status: 'queried',
        query_note: 'Query Thursday',
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    const [, patch] = timesheetRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(patch).not.toHaveProperty('query_note');
  });
});

// =============================================================================
// Phase 2 review, finding 6: the mutation responses are wire responses.
//
// `timesheet.schema.ts` documents the four snapshot columns as deliberately
// NOT on the wire — the week read hands back a parsed, state-tagged
// `earnings` field instead, so a client never sees a frozen figure without
// the legacy/corrupt handling the server does on its behalf. `approve` and
// `query` returned the raw repository row, snapshot columns and all.
// =============================================================================

const SNAPSHOT_KEYS = [
  'gross_minor',
  'currency',
  'earnings',
  'earnings_computed_at',
] as const;

describe('TimesheetCommandService — mutation responses carry no snapshot columns', () => {
  it('approve returns the wire timesheet, not the row it just froze', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeApprovingRepo(),
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      makeEarnings()
    );

    const approved = await svc.approve('parent-1', 'ts1');

    expect(approved.status).toBe('approved');
    for (const key of SNAPSHOT_KEYS) {
      expect(approved).not.toHaveProperty(key);
    }
  });

  it('query returns the wire timesheet even when the row still carries a stale snapshot', async () => {
    const timesheetRepo = makeTimesheetRepo({
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...timesheet,
        gross_minor: 37_000,
        currency: 'GBP',
        earnings: computedEarnings,
        earnings_computed_at: '2026-08-10T09:00:00.000Z',
        ...patch,
      })),
    });
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      makeEarnings()
    );

    const queried = await svc.query('parent-1', 'ts1', { note: 'Thursday?' });

    expect(queried.status).toBe('queried');
    for (const key of SNAPSHOT_KEYS) {
      expect(queried).not.toHaveProperty(key);
    }
  });
});

// =============================================================================
// Max session span — assertClockOrder hard ceiling (above the mobile 10h
// MAX_UNSCHEDULED_SHIFT_MS reminder). A forgotten clock-out that "finishes
// next day" must not bank a 22h paycheck.
// =============================================================================
describe('TimesheetCommandService — max session span', () => {
  function makeSpanSvc(entryOverrides: Record<string, unknown> = {}) {
    return new TimesheetCommandService(
      makeTimeEntryRepo({
        listForCarerWeek: mock(async () => []),
        update: mock(async (_id: string, patch: Record<string, unknown>) => ({
          ...runningEntry,
          ...entryOverrides,
          ...patch,
          status: 'submitted',
        })),
        createSubmitted: mock(async (data: Record<string, unknown>) => ({
          ...submittedEntry,
          ...data,
          id: 't-span',
        })),
      }),
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimeEntry: mock(async () => ({
          ...runningEntry,
          ...entryOverrides,
        })),
      }),
      makeUserService()
    );
  }

  it('rejects a 17h span — above the 16h hard ceiling', async () => {
    const svc = makeSpanSvc({
      clock_in_at: '2026-08-03T06:00:00.000Z',
    });

    await expect(
      svc.clockOut('carer-1', 't1', {
        clock_out_at: '2026-08-03T23:00:00.000Z', // 17h
      })
    ).rejects.toBeInstanceOf(InvalidClockTimesError);
  });

  it('accepts a 15h span — under the 16h hard ceiling', async () => {
    const svc = makeSpanSvc({
      clock_in_at: '2026-08-03T08:00:00.000Z',
    });

    const result = await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T23:00:00.000Z', // 15h
    });

    expect(result.clock_out_at).toBe('2026-08-03T23:00:00.000Z');
  });
});

// =============================================================================
// Reopen — parent undo for an approved week. Clears the frozen earnings
// snapshot (same CLEARED_EARNINGS_SNAPSHOT write as rollUpIntoTimesheet) and
// returns the week to submitted so corrections can land again.
// =============================================================================
describe('TimesheetCommandService.reopen', () => {
  const approvedTimesheet = {
    ...timesheet,
    status: 'approved',
    approved_by: 'parent-1',
    approved_at: '2026-08-04T18:00:00.000Z',
    gross_minor: 14_800,
    currency: 'GBP',
    earnings: { status: 'ok', gross_minor: 14_800 },
    earnings_computed_at: '2026-08-04T18:00:00.000Z',
  };

  it('reopens an approved week: clears the snapshot and accepts corrections again', async () => {
    const timesheetRepo = makeTimesheetRepo({
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...approvedTimesheet,
        ...patch,
      })),
      findByWeek: mock(async () => ({
        ...timesheet,
        status: 'submitted',
      })),
    });
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [{ ...finishedEntryA, id: 't1' }]),
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...submittedEntry,
        ...patch,
      })),
    });
    const eventRepo = {
      insertMany: mock(async () => undefined),
    };
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => approvedTimesheet),
        getOwnedTimeEntry: mock(async () => submittedEntry),
      }),
      makeUserService(),
      makePush(),
      makeEarnings(),
      eventRepo
    );

    const reopened = await svc.reopen('parent-1', 'ts1', {
      reason: 'Thursday hours were wrong',
    });

    expect(reopened.status).toBe('submitted');
    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({
        status: 'submitted',
        approved_by: null,
        approved_at: null,
        gross_minor: null,
        currency: null,
        earnings: null,
        earnings_computed_at: null,
        reopen_reason: 'Thursday hours were wrong',
      })
    );
    // Display state on the row (so a cold-start carer sees why pay moved)
    // AND permanent audit in the day-thread. Never on `query_note` — that
    // column means "a parent queried this week" and ParentWeekView renders
    // it unconditionally as "Queried: {{note}}"; writing a reopen reason
    // there mislabels an undo-approve as an open dispute (review finding).
    const [, patch] = (timesheetRepo.update as ReturnType<typeof mock>).mock
      .calls[0] as [string, Record<string, unknown>];
    expect(patch).not.toHaveProperty('query_note');
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        event_type: 'timesheet_reopened',
        local_date: '2026-08-03',
        actor_id: 'parent-1',
        payload: expect.objectContaining({
          reason: 'Thursday hours were wrong',
          timesheetId: 'ts1',
        }),
      }),
    ]);

    // Corrections must be accepted again after reopen.
    await svc.updateEntry('carer-1', 't1', { break_minutes: 0 });
    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ break_minutes: 0 })
    );
  });

  it('pushes the carer once with TIMESHEET_REOPENED when a week is reopened', async () => {
    const push = makePush();
    const timesheetRepo = makeTimesheetRepo({
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...approvedTimesheet,
        ...patch,
      })),
    });
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => approvedTimesheet),
      }),
      makeUserService(),
      push,
      makeEarnings(),
      { insertMany: mock(async () => undefined) }
    );

    await svc.reopen('parent-1', 'ts1', { reason: 'missed break' });

    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    expect(push.notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.TIMESHEET_REOPENED,
          timesheetId: 'ts1',
          householdId: 'h1',
          weekStart: '2026-08-03',
        }),
      })
    );
    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('still returns the reopened timesheet when the carer push throws', async () => {
    const push = makePush({
      notifyUser: mock(() => {
        throw new Error('expo down');
      }),
    });
    const timesheetRepo = makeTimesheetRepo({
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...approvedTimesheet,
        ...patch,
      })),
    });
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => approvedTimesheet),
      }),
      makeUserService(),
      push,
      makeEarnings(),
      { insertMany: mock(async () => undefined) }
    );

    const result = await svc.reopen('parent-1', 'ts1', {
      reason: 'missed break',
    });
    expect(result.status).toBe('submitted');
  });

  it('two reopens produce two append-only audit rows', async () => {
    const eventRepo = {
      insertMany: mock(async () => undefined),
    };
    // Both reads return approved — models parent re-approving between the
    // two undos. Each reopen appends its own day-thread row.
    const timesheetRepo = makeTimesheetRepo({
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...approvedTimesheet,
        ...patch,
      })),
    });
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => approvedTimesheet),
      }),
      makeUserService(),
      makePush(),
      makeEarnings(),
      eventRepo
    );

    await svc.reopen('parent-1', 'ts1', { reason: 'first' });
    await svc.reopen('parent-1', 'ts1', { reason: 'second' });

    expect(eventRepo.insertMany).toHaveBeenCalledTimes(2);
    // `mock()` with no declared args types `.mock.calls` as an empty tuple,
    // so the hop through `unknown` is the only way to read the recorded
    // argument back out — same reason the compiler suggests it.
    type ReopenEventArg = Array<{ payload: { reason: string } }>;
    const [first] = eventRepo.insertMany.mock.calls[0] as unknown as [
      ReopenEventArg,
    ];
    const [second] = eventRepo.insertMany.mock.calls[1] as unknown as [
      ReopenEventArg,
    ];
    expect(first[0]?.payload.reason).toBe('first');
    expect(second[0]?.payload.reason).toBe('second');
  });

  // THE TEST THAT MATTERS MOST: display state vs permanent audit.
  // Re-approving clears `reopen_reason` (so a cold-start UI stops showing
  // "why was this undone") but must NEVER touch the day-thread rows — those
  // are the permanent record that the week was un-approved, twice if twice.
  it('re-approving a reopened week clears reopen_reason and leaves audit events untouched', async () => {
    const eventRepo = {
      insertMany: mock(async () => undefined),
    };
    const timesheetRepo = makeApprovingRepo({
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...approvedTimesheet,
        ...patch,
      })),
    });
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => approvedTimesheet),
      }),
      makeUserService(),
      makePush(),
      makeEarnings(),
      eventRepo
    );

    await svc.reopen('parent-1', 'ts1', { reason: 'Thursday was wrong' });
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({
        reopen_reason: 'Thursday was wrong',
      })
    );

    // Parent re-approves the (now submitted) week. The owned read after
    // reopen must look submitted with the display reason still set.
    const reopenedRow = {
      ...timesheet,
      status: 'submitted' as const,
      reopen_reason: 'Thursday was wrong',
      updated_at: '2026-08-04T19:00:00.000Z',
    };
    const approveSvc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => reopenedRow),
      }),
      makeUserService(),
      makePush(),
      makeEarnings(),
      eventRepo
    );
    await approveSvc.approve('parent-1', 'ts1');

    expect(timesheetRepo.approveSubmittedWithEarnings).toHaveBeenCalledTimes(1);
    // Audit rows are append-only — approve must not insert, update, or
    // delete any timesheet_reopened event.
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a nanny trying to reopen', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(), // nanny
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => approvedTimesheet),
      }),
      makeUserService()
    );

    await expect(
      svc.reopen('carer-1', 'ts1', { reason: 'please' })
    ).rejects.toBeInstanceOf(NotATimesheetParentError);
  });

  it('rejects reopening a week that is not approved', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimesheet: mock(async () => ({
          ...timesheet,
          status: 'submitted',
        })),
      }),
      makeUserService()
    );

    await expect(
      svc.reopen('parent-1', 'ts1', { reason: 'changed my mind' })
    ).rejects.toBeInstanceOf(TimesheetNotActionableError);
  });
});

// =============================================================================
// Overlap guard — two completed entries for one carer must not intersect.
// Editing an entry against itself is not an overlap.
// =============================================================================
describe('TimesheetCommandService — entry overlap', () => {
  const existingCompleted = {
    ...submittedEntry,
    id: 't-existing',
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T16:00:00.000Z',
  };

  it('rejects a retroactive entry that overlaps another completed entry for the same carer', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      createSubmitted: mock(async () => {
        throw new Error('createSubmitted must not be called on overlap');
      }),
      listForCarerWeek: mock(async () => [existingCompleted]),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    const err = await svc
      .createRetroactiveEntry('carer-1', {
        household_id: 'h1',
        // Overlaps existing 08:00–16:00
        clock_in_at: '2026-08-03T12:00:00.000Z',
        clock_out_at: '2026-08-03T18:00:00.000Z',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeEntryOverlapError);
    expect((err as TimeEntryOverlapError).metadata).toMatchObject({
      overlappingClockInAt: existingCompleted.clock_in_at,
      overlappingClockOutAt: existingCompleted.clock_out_at,
    });
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('allows editing an entry against itself — self is not an overlap', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [
        { ...submittedEntry, break_minutes: 0 },
      ]),
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...submittedEntry,
        ...patch,
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimeEntry: mock(async () => submittedEntry),
      }),
      makeUserService()
    );

    // Same span as the entry itself — must not count as overlapping self.
    const result = await svc.updateEntry('carer-1', 't1', {
      clock_in_at: '2026-08-03T08:00:00.000Z',
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(result.clock_out_at).toBe('2026-08-03T16:00:00.000Z');
    expect(timeEntryRepo.update).toHaveBeenCalled();
  });

  it('rejects an edit whose new span overlaps a different completed entry', async () => {
    const other = {
      ...submittedEntry,
      id: 't-other',
      clock_in_at: '2026-08-03T14:00:00.000Z',
      clock_out_at: '2026-08-03T20:00:00.000Z',
    };
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [submittedEntry, other]),
      update: mock(async () => {
        throw new Error('update must not be called on overlap');
      }),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimeEntry: mock(async () => submittedEntry),
      }),
      makeUserService()
    );

    const err = await svc
      .updateEntry('carer-1', 't1', {
        // Extend finish into the other entry's span
        clock_out_at: '2026-08-03T15:00:00.000Z',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeEntryOverlapError);
    expect((err as TimeEntryOverlapError).metadata).toMatchObject({
      overlappingClockInAt: other.clock_in_at,
      overlappingClockOutAt: other.clock_out_at,
    });
  });

  // -------------------------------------------------------------------------
  // clockOut overlap hole: assertNoOverlap was called from createRetroactive
  // and updateEntry but NOT clockOut, and it skips running entries. Reachable
  // path — edit a completed finish into a running session's span, then clock
  // out the runner — double-counted those minutes in total_minutes and the
  // frozen gross. Guard must use the RESOLVED clockOutAt (server clock when
  // omitted) and exclude the running row's own id.
  // -------------------------------------------------------------------------
  it('rejects a clock-out whose span overlaps a different completed entry', async () => {
    // E1 completed 08:00–10:00; running E2 (t1) started 09:30; clocking out
    // at 11:00 would overlap E1 by 30 minutes.
    const otherCompleted = {
      id: 't-other',
      clock_in_at: '2026-08-03T08:00:00.000Z',
      clock_out_at: '2026-08-03T10:00:00.000Z',
      break_minutes: 0,
    };
    const runningLater = {
      ...runningEntry,
      clock_in_at: '2026-08-03T09:30:00.000Z',
    };
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [otherCompleted, runningLater]),
      update: mock(async () => {
        throw new Error('update must not be called on overlap');
      }),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimeEntry: mock(async () => runningLater),
      }),
      makeUserService()
    );

    const err = await svc
      .clockOut('carer-1', 't1', {
        clock_out_at: '2026-08-03T11:00:00.000Z',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeEntryOverlapError);
    expect((err as TimeEntryOverlapError).metadata).toMatchObject({
      overlappingClockInAt: otherCompleted.clock_in_at,
      overlappingClockOutAt: otherCompleted.clock_out_at,
    });
    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });

  it('allows a non-overlapping clock-out next to a completed entry', async () => {
    // Touching end-to-start is allowed — back-to-back sessions are ordinary.
    const priorCompleted = {
      id: 't-other',
      clock_in_at: '2026-08-03T08:00:00.000Z',
      clock_out_at: '2026-08-03T12:00:00.000Z',
      break_minutes: 0,
    };
    const runningAfter = {
      ...runningEntry,
      clock_in_at: '2026-08-03T12:00:00.000Z',
    };
    const finishedAfter = {
      ...runningAfter,
      id: 't1',
      clock_out_at: '2026-08-03T16:00:00.000Z',
      break_minutes: 0,
      status: 'submitted',
    };
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [priorCompleted, finishedAfter]),
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...runningAfter,
        ...patch,
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({
        getOwnedTimeEntry: mock(async () => runningAfter),
      }),
      makeUserService()
    );

    const result = await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });
    expect(result.clock_out_at).toBe('2026-08-03T16:00:00.000Z');
    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        clock_out_at: '2026-08-03T16:00:00.000Z',
        status: 'submitted',
      })
    );
  });
});

import { describe, expect, it, mock } from 'bun:test';
import { ShiftNotFoundError } from '../../../../../src/domains/shift';
import {
  AlreadyClockedInError,
  NotACarerError,
  NotATimesheetParentError,
  TimeEntryNotRunningError,
  TimesheetNotActionableError,
} from '../../../../../src/domains/timesheet/errors/timesheetErrors';
import {
  computeWorkedMinutes,
  sumWorkedMinutes,
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
      makeQueries()
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
      makeQueries()
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
      makeQueries()
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
      makeQueries()
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
    makeQueries()
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
      makeQueries()
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
const finishedEntryA = {
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
        total_minutes: 450, // sumWorkedMinutes([finishedEntryA])
        status: 'submitted',
      })
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
      })
    );

    await svc.clockOut('carer-1', 't1', { break_minutes: 30 });

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
      makeQueries()
    );

    await svc.clockOut('carer-1', 't1', {});

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
      makeQueries()
    );

    await svc.clockOut('carer-1', 't1', {});

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
      makeQueries()
    );

    await svc.clockOut('carer-1', 't1', {});
    await svc.clockOut('carer-1', 't1', {});

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
      makeQueries()
    );

    await svc.clockOut('carer-1', 't1', {});

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
      makeQueries()
    );

    await svc.clockOut('carer-1', 't1', {});

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
      makeQueries()
    );

    await svc.clockOut('carer-1', 't1', {});

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

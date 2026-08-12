import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { WeekEarnings } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { WeekEarningsService } from '../../../../../src/domains/pay/services/weekEarningsService';
import { ShiftNotFoundError } from '../../../../../src/domains/shift';
import {
  AlreadyClockedInError,
  CancellationPaidAlreadyRecordedError,
  InvalidClockTimesError,
  NotACarerError,
  NotATimesheetParentError,
  TimeEntryNotEditableError,
  TimeEntryNotFoundError,
  TimeEntryNotRunningError,
  TimeEntryOverlapError,
  TimesheetAdjustmentNegativeGrossError,
  TimesheetAdjustmentNotAllowedError,
  TimesheetGrossTooLargeError,
  TimesheetNotActionableError,
} from '../../../../../src/domains/timesheet/errors/timesheetErrors';
import {
  computeWorkedMinutes,
  recordCancellationPaidEntry,
  sumWorkedMinutes,
  TimesheetCommandService,
} from '../../../../../src/domains/timesheet/services/timesheetCommandService';
import { localDateOf } from '../../../../../src/domains/timesheet/utils/weekStart';

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

// `week_starts_on` is spelled out rather than left off: omitting it would
// send every test in this file down the `?? DEFAULT_WEEK_STARTS_ON` fallback
// instead of the real read, so the threading would be untested everywhere and
// green anyway. 1 = Monday, matching migration 075's column default.
const household = { id: 'h1', timezone: 'Europe/London', week_starts_on: 1 };

function makeTimeEntryRepo(overrides: Record<string, unknown> = {}): any {
  const repo: any = {
    findRunningForCarer: mock(async () => null),
    clockIn: mock(async () => ({ ...runningEntry })),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      ...runningEntry,
      ...patch,
    })),
    // Default empty — tests exercising the roll-up's total override this
    // with a fixed, known set of finished entries.
    listForCarerWeek: mock(async () => []),
    // Default empty — the overlap check's own source, separate from the
    // roll-up's week view because it asks about clock spans, not local_date.
    listOverlapCandidatesForCarer: mock(async () => []),
    ...overrides,
  };
  // Models `voidById`'s CONDITIONAL write (`.neq('status','voided')`): the
  // first call flips the row, a racing second call matches NOTHING and
  // returns null. That null is the whole basis of idempotent DELETE — a mock
  // that always returned a row would leave the real semantics untested.
  // Delegates to `update` so a test overriding it still drives the row shape.
  if (!repo.voidById) {
    const voidedIds = new Set<string>();
    repo.voidById = mock(async (id: string) => {
      if (voidedIds.has(id)) return null;
      voidedIds.add(id);
      return repo.update(id, { status: 'voided' });
    });
  }
  return repo;
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
    // The two conditional writes, defaulted to "won the race". A test that
    // wants a lost race stages it explicitly — losing must never be the
    // accidental default.
    queryFromActionable: mock(
      async (_id: string, _expectedUpdatedAt: string, note: string) => ({
        ...timesheet,
        status: 'queried',
        query_note: note,
      })
    ),
    reopenFromApproved: mock(
      async (_id: string, _expectedUpdatedAt: string, reason: string) => ({
        ...timesheet,
        status: 'submitted',
        approved_by: null,
        approved_at: null,
        reopen_reason: reason,
        gross_minor: null,
        currency: null,
        earnings: null,
        earnings_computed_at: null,
      })
    ),
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

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    insertMany: mock(async () => []),
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

  it('pushes the carer once with TIMESHEET_APPROVED when a week is approved', async () => {
    const push = makePush();
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
      push,
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

    await svc.approve('parent-1', 'ts1');

    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    expect(push.notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.TIMESHEET_APPROVED,
          timesheetId: 'ts1',
          householdId: 'h1',
          weekStart: '2026-08-03',
        }),
      })
    );
    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('still returns the approved timesheet when the carer push throws', async () => {
    const push = makePush({
      notifyUser: mock(() => {
        throw new Error('expo down');
      }),
    });
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
      push,
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
    expect(timesheetRepo.approveSubmittedWithEarnings).toHaveBeenCalledTimes(1);
  });

  // N17 / §2.3b (D-32 extension, 3-U3): the approved-and-still-short case
  // REPLACES `timesheet_approved` with `week_below_guarantee` — one act, one
  // push, never both. Emitted only when the FROZEN snapshot still carries a
  // `guaranteed_topup` line: the top-up did its job at every OTHER week, so
  // its presence here means the guarantee itself was still short even after
  // topping up (or, per the spec, no arrangement covered every day).
  it('pushes week_below_guarantee INSTEAD OF timesheet_approved when the frozen snapshot still tops up', async () => {
    const push = makePush();
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
      push,
      {
        computeForWeek: mock(
          async (): Promise<WeekEarnings> => ({
            status: 'ok',
            week_start: '2026-08-03',
            currency: 'GBP',
            lines: [
              {
                kind: 'regular',
                minutes: 2640,
                rate_minor: 1850,
                multiplier: null,
                amount_minor: 81_400,
                from_date: '2026-08-03',
                to_date: '2026-08-07',
                arrangement_id: '11111111-1111-4111-8111-111111111111',
              },
              {
                kind: 'guaranteed_topup',
                minutes: 360,
                rate_minor: 1850,
                multiplier: null,
                amount_minor: 11_100,
                from_date: '2026-08-03',
                to_date: '2026-08-09',
                arrangement_id: '11111111-1111-4111-8111-111111111111',
              },
            ],
            gross_minor: 92_500,
            reimbursements_minor: 0,
            worked_minutes: 2640,
            payable_minutes: 2640,
            guaranteed_minutes_per_week: 3000,
          })
        ),
      }
    );

    await svc.approve('parent-1', 'ts1');

    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    expect(push.notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.WEEK_BELOW_GUARANTEE,
          timesheetId: 'ts1',
          householdId: 'h1',
          weekStart: '2026-08-03',
        }),
      })
    );
    const [, payload] = push.notifyUser.mock.calls[0] as [
      string,
      { title: string; body: string },
    ];
    // A8 still binds: hours in the body, the gross figure stays out.
    expect(payload.body).not.toMatch(/£|\$|GBP|USD/);
    expect(payload.body).toMatch(/44h/); // 2640 minutes payable = 44h
    expect(payload.body).toMatch(/50h/); // 3000 minutes guaranteed = 50h
    expect(payload.body).toMatch(/6h/); // shortfall = 360 minutes = 6h
  });

  it('still pushes timesheet_approved (not week_below_guarantee) when the frozen snapshot has NO top-up line', async () => {
    const push = makePush();
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
      push,
      {
        computeForWeek: mock(
          async (): Promise<WeekEarnings> => ({
            status: 'ok',
            week_start: '2026-08-03',
            currency: 'GBP',
            lines: [
              {
                kind: 'regular',
                minutes: 2400,
                rate_minor: 1850,
                multiplier: null,
                amount_minor: 74_000,
                from_date: '2026-08-03',
                to_date: '2026-08-07',
                arrangement_id: '11111111-1111-4111-8111-111111111111',
              },
            ],
            gross_minor: 74_000,
            reimbursements_minor: 0,
            worked_minutes: 2400,
            payable_minutes: 2400,
            guaranteed_minutes_per_week: null,
          })
        ),
      }
    );

    await svc.approve('parent-1', 'ts1');

    expect(push.notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.TIMESHEET_APPROVED,
        }),
      })
    );
  });

  it('pushes plain timesheet_approved (never week_below_guarantee) for an unpriceable week — no fabricated guarantee claim', async () => {
    const push = makePush();
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
      push,
      {
        computeForWeek: mock(
          async (): Promise<WeekEarnings> => ({
            status: 'no_arrangement',
            week_start: '2026-08-03',
            unpriced_dates: ['2026-08-03'],
          })
        ),
      }
    );

    await svc.approve('parent-1', 'ts1');

    expect(push.notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.TIMESHEET_APPROVED,
        }),
      })
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
      makeUserService(),
      makePush(),
      makeEarnings(),
      makeEventRepo()
    );

    await svc.query('parent-1', 'ts1', { note: 'Query Thursday' });

    expect(timesheetRepo.queryFromActionable).toHaveBeenCalledWith(
      'ts1',
      timesheet.updated_at,
      'Query Thursday'
    );
    expect(timesheetRepo.update).not.toHaveBeenCalled();
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
      push,
      makeEarnings(),
      makeEventRepo()
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
      push,
      makeEarnings(),
      makeEventRepo()
    );

    const result = await svc.query('parent-1', 'ts1', {
      note: 'Query Thursday',
    });

    expect(result.status).toBe('queried');
    expect(timesheetRepo.queryFromActionable).toHaveBeenCalled();
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

  /**
   * The roll-up's view of the week once the create has landed. The overlap
   * check no longer reads this list at all — it asks
   * `listOverlapCandidatesForCarer` about clock spans instead.
   */
  function listForCarerWeekAfterCreate(afterCreate: unknown[]) {
    return mock(async () => afterCreate);
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
          listForCarerWeek: listForCarerWeekAfterCreate([
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
      listForCarerWeek: listForCarerWeekAfterCreate([
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
      listForCarerWeek: listForCarerWeekAfterCreate([
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

    expect(result[0]?.kind).toBe('cancellation_paid');
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

    expect(result[0]?.kind).toBe('cancellation_paid');
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
    // Idempotency is structural since 053: the already-written row is an
    // overlap candidate, so it is subtracted from the remainder and there is
    // nothing left to write.
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [cancellationEntry]),
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

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('stays at one row when a concurrent insert races past find-first (23505)', async () => {
    // Find-first is an optimisation only — the partial unique index is the
    // source of truth. Simulate the losing racer: pre-check miss, insert
    // hits 23505, re-fetch returns the winner's row.
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForSpan: mock(async () => cancellationEntry),
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

    expect(result.map(e => e.id)).toEqual(['t-cancel']);
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledTimes(1);
    expect(timeEntryRepo.findCancellationPaidForSpan).toHaveBeenCalledWith(
      's1',
      paidShift.starts_at
    );
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

    expect(result).toEqual([]);
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
      // `v: 1` stamps the FORMAT of the frozen jsonb, not the week: a reader
      // that meets a `v` it does not know refuses the snapshot rather than
      // reinterpreting it (`timesheet.schema.ts`).
      earnings: { ...computedEarnings, v: 1 },
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
    expect(patch.earnings).toEqual({ ...other, v: 1 });
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
    // Stamped on the unpriceable arms too — the format claim is about the
    // jsonb, and every arm the approve path writes is jsonb.
    expect(patch.earnings).toEqual({ ...noArrangement, v: 1 });
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
// Capped inputs do not bound their PRODUCT (adversarial review REOPEN).
//
// `rate_minor` is capped at MAX_MONEY_MINOR and hours are capped by the week,
// and neither cap says anything about `hours x rate`. 40 hours at the
// schema-legal maximum rate computes 3_999_999_960 — not merely over
// migration 063's `timesheets_gross_minor_upper`, but over int4 itself, so
// the approve used to die on a raw Postgres "value out of range" with no
// typed error and no readable message for the parent who tapped Approve.
//
// These pin the CLEAN failure: the guard sits where the ok-arm's gross is
// first known, so it fires BEFORE the CAS write. The gross is never clamped
// to fit — `docs/11-MONEY.md` §1, a trimmed gross is a wrong paycheck that
// would actually be paid.
// =============================================================================

describe('TimesheetCommandService.approve — a computed gross over the money cap', () => {
  const MAX_GROSS_MINOR = 99_999_999;

  /**
   * The engine's ok arm, priced at whatever gross the caller needs. Only
   * `gross_minor` moves — the guard reads the WEEK TOTAL and nothing else, so
   * restating the line items would be fixture noise pretending to be coverage.
   */
  function earningsGrossing(grossMinor: number): any {
    // `computedEarnings` is annotated as the whole `WeekEarnings` union, and
    // only the `ok` arm has a `gross_minor` to move — narrow to it so the
    // override is type-checked against a PRICED week, not the union.
    const okWeek = computedEarnings as Extract<WeekEarnings, { status: 'ok' }>;
    const priced = { ...okWeek, gross_minor: grossMinor };
    return makeEarnings({ computeForWeek: mock(async () => priced) });
  }

  function approvingSvc(earnings: any, timesheetRepo: any) {
    return new TimesheetCommandService(
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
  }

  it('refuses the approval with a typed error and never reaches the CAS write', async () => {
    const timesheetRepo = makeApprovingRepo();
    // 40h at the schema-legal max rate — both inputs legal, product is not.
    const svc = approvingSvc(earningsGrossing(3_999_999_960), timesheetRepo);

    await expect(svc.approve('parent-1', 'ts1')).rejects.toBeInstanceOf(
      TimesheetGrossTooLargeError
    );
    expect(timesheetRepo.approveSubmittedWithEarnings).not.toHaveBeenCalled();
  });

  it('names the computed gross and the cap, so the refusal is diagnosable', async () => {
    const svc = approvingSvc(
      earningsGrossing(3_999_999_960),
      makeApprovingRepo()
    );

    const err = (await svc
      .approve('parent-1', 'ts1')
      .catch((e: unknown) => e)) as {
      statusCode?: number;
      metadata?: { grossMinor?: number; maxMinor?: number };
    };

    expect(err.statusCode).toBe(400);
    expect(err.metadata?.grossMinor).toBe(3_999_999_960);
    expect(err.metadata?.maxMinor).toBe(MAX_GROSS_MINOR);
  });

  it('never CLAMPS the gross down to the cap — that would be a wrong paycheck', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(earningsGrossing(3_999_999_960), timesheetRepo);

    await svc.approve('parent-1', 'ts1').catch(() => undefined);

    // Total refusal: no write at all, let alone one carrying a trimmed gross.
    expect(timesheetRepo.approveSubmittedWithEarnings).not.toHaveBeenCalled();
  });

  it('BOUNDARY: a gross landing exactly ON the cap approves normally', async () => {
    // The guard must be `>` and not `>=`, or the largest legal week becomes
    // unapprovable.
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(earningsGrossing(MAX_GROSS_MINOR), timesheetRepo);

    await svc.approve('parent-1', 'ts1');

    const [, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(patch.gross_minor).toBe(MAX_GROSS_MINOR);
  });

  it('a NON-ok engine arm is untouched by the guard — it freezes a NULL gross, not a big one', async () => {
    // The unpriceable arms (`no_arrangement`, `currency_change`) write
    // `gross_minor: null` by design. A guard reading the wrong field would
    // turn every one of those into a spurious 400.
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(
      makeEarnings({
        computeForWeek: mock(async () => ({
          status: 'no_arrangement',
          week_start: '2026-08-03',
        })),
      }),
      timesheetRepo
    );

    await svc.approve('parent-1', 'ts1');

    const [, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(patch.gross_minor).toBeNull();
  });
});

// =============================================================================
// F-B10-4: approve freezes figures the REAL earnings engine computed.
//
// Every test above injects a stubbed `computeForWeek`, so the frozen
// `gross_minor` is a literal that appears on both sides of the assertion and
// nothing actually prices anything. That leaves the most expensive integration
// in the app — "the number the parent approves is the number the engine
// produced from the hours on file" — completely unpinned: the whole engine
// could be replaced with `() => 0` and every approve test would stay green.
//
// This block wires a REAL `WeekEarningsService` over in-memory repositories
// into `TimesheetCommandService`'s ninth constructor argument. The expected
// figure below is hand-computed from rule I-15, NOT copied from the engine's
// output — copying it would only prove the engine equals itself.
// =============================================================================

/** A `pay_arrangements` row (041). */
function payArrangement(over: Record<string, unknown> = {}): any {
  return {
    id: ARRANGEMENT_ID,
    household_id: 'h1',
    carer_id: 'carer-1',
    rate_minor: 1850,
    bill_rate_minor: null,
    currency: 'GBP',
    overtime_threshold_minutes: null,
    overtime_multiplier: 1.5,
    guaranteed_minutes_per_week: null,
    pto_entitlement_minutes_per_year: null,
    mileage_rate_per_mile_minor: null,
    cancellation_paid_within_hours: null,
    valid_from: '2026-07-01',
    carer_display_name: 'Nia Rowe',
    note: null,
    created_by: null,
    // JS spelling. Its predecessor below carries the PostgREST one — the
    // engine's tie-break `Date.parse`es both, and a fixture set written in one
    // style proves nothing about that (GOLDEN-FIXES #25).
    created_at: '2026-06-20T09:00:00.000Z',
    ...over,
  };
}

const SUPERSEDED_ARRANGEMENT_ID = '11111111-1111-4111-8111-111111111102';

/** A worked `time_entries` row (017) for the real engine to price. */
function workedEntry(over: Record<string, unknown> = {}): any {
  return {
    ...runningEntry,
    id: 'te-real-1',
    shift_id: null,
    kind: 'worked',
    status: 'submitted',
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T16:00:00.000Z',
    break_minutes: 0,
    local_date: '2026-08-03',
    ...over,
  };
}

/**
 * The seven repositories `WeekEarningsService` fetches through, all in
 * memory. Same shape as the fakes in `weekEarningsService.test.ts`.
 */
function makeRealEarnings(
  entries: any[],
  arrangements: any[],
  expenses: any[] = []
): any {
  return new WeekEarningsService(
    { listForCarerWeek: mock(async () => entries) } as any,
    { listForCarer: mock(async () => arrangements) } as any,
    { listForCarerYear: mock(async () => []) },
    { listApprovedForWeek: mock(async () => expenses) },
    // 080's holiday toggles. Empty, and it must be SUPPLIED rather than left
    // to the constructor default — the default is the real repository, which
    // would reach the network from a unit test.
    { listForHousehold: mock(async () => []) }
  );
}

describe('TimesheetCommandService.approve — freezes figures computed by the REAL earnings engine (F-B10-4)', () => {
  it('freezes a gross the engine derived from the week’s actual entries, half-up at the exact .5 boundary', async () => {
    // The week (Mon 2026-08-03): two worked entries for one carer.
    //   Mon  08:00Z -> 16:00Z, 0 break  = 480 min
    //   Tue  09:00Z -> 10:33Z, 30 break =  63 min   (93 span - 30 break)
    //                                    -------
    //                                     543 min
    // Both price at the arrangement in force on their own date. Two
    // arrangements are on file and BOTH are in force on this week (valid_from
    // 2026-01-01 and 2026-07-01), so the engine has to actually resolve —
    // greatest valid_from wins — and pick 1850, not the superseded 1500.
    // They merge into ONE regular line (same arrangement id), which is what
    // makes the rounding land on the total rather than per day.
    //
    // HAND-COMPUTED, rule I-15: priceMinutes(m, r) = floor((2mr + 60) / 120)
    //   543 x 1850                  = 1_004_550           (exact, integer)
    //   (2 x 1_004_550 + 60) / 120  = 2_009_160 / 120
    //                               = 16_743.0            (floor -> 16_743)
    // Cross-check in decimal: 1_004_550 / 60 = 16_742.5 exactly — the half
    // case, so half-UP is the whole difference between 16_743 and 16_742.
    // £167.43 for 9h03m at £18.50/h.
    //
    // The approved expense is £12.75 and must NOT join gross (I-27): it lands
    // on its own reimbursements line and in `reimbursements_minor`.
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
      makeRealEarnings(
        [
          workedEntry(),
          workedEntry({
            id: 'te-real-2',
            clock_in_at: '2026-08-04T09:00:00.000Z',
            clock_out_at: '2026-08-04T10:33:00.000Z',
            break_minutes: 30,
            local_date: '2026-08-04',
          }),
        ],
        [
          payArrangement(),
          payArrangement({
            id: SUPERSEDED_ARRANGEMENT_ID,
            rate_minor: 1500,
            valid_from: '2026-01-01',
            // PostgREST spelling — see `payArrangement`'s note.
            created_at: '2026-01-01T09:00:00+00:00',
          }),
        ],
        [
          {
            id: 'exp-real-1',
            household_id: 'h1',
            carer_id: 'carer-1',
            local_date: '2026-08-05',
            kind: 'expense',
            description: 'Soft play entry',
            amount_minor: 1275,
            miles: null,
            currency: 'GBP',
            status: 'approved',
          },
        ]
      )
    );

    await svc.approve('parent-1', 'ts1');

    const [, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];

    expect(patch.gross_minor).toBe(16_743);
    expect(patch.currency).toBe('GBP');
    expect(patch.earnings_computed_at).toBe(patch.approved_at);
    expect(patch.earnings_computed_at).toEqual(expect.any(String));

    const frozen = patch.earnings as WeekEarnings;
    expect(frozen.status).toBe('ok');
    if (frozen.status !== 'ok') return;
    // Reimbursements are money, but not WAGES — a separate total, never
    // folded into gross (I-27, docs/11-MONEY.md §6).
    expect(frozen.reimbursements_minor).toBe(1275);
    expect(frozen.gross_minor).toBe(16_743);
    expect(frozen.worked_minutes).toBe(543);
    expect(frozen.payable_minutes).toBe(543);
    expect(frozen.lines).toEqual([
      {
        kind: 'regular',
        minutes: 543,
        rate_minor: 1850,
        multiplier: null,
        amount_minor: 16_743,
        from_date: '2026-08-03',
        to_date: '2026-08-04',
        arrangement_id: ARRANGEMENT_ID,
      },
      {
        kind: 'reimbursements',
        minutes: 0,
        rate_minor: 0,
        multiplier: null,
        amount_minor: 1275,
        from_date: '2026-08-05',
        to_date: '2026-08-05',
        arrangement_id: null,
      },
    ]);
  });

  it('freezes the engine’s no_arrangement arm — not a £0.00 — when the carer has no pay terms on file', async () => {
    // Same wiring, arrangements empty. Proves the arm the approve path writes
    // is the engine's own verdict rather than anything this test decided:
    // gross and currency stay NULL and the week's last day is named as
    // unpriceable (docs/11-MONEY.md §4).
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
      makeRealEarnings([workedEntry()], [])
    );

    await svc.approve('parent-1', 'ts1');

    const [, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(patch.gross_minor).toBeNull();
    expect(patch.currency).toBeNull();
    expect(patch.earnings).toEqual({
      status: 'no_arrangement',
      week_start: '2026-08-03',
      unpriced_dates: ['2026-08-03', '2026-08-09'],
      v: 1,
    });
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** `updated_at` of the row `approve` reads before it computes anything. */
const _versionAtReadInstant = new Date(Date.now() - 2 * DAY_MS);
_versionAtReadInstant.setUTCHours(8, 59, 12, 123);
const VERSION_AT_READ = _versionAtReadInstant
  .toISOString()
  .replace('.123Z', '.123456+00:00');
/** ...and what the trigger stamps once a concurrent roll-up has written. */
const VERSION_AFTER_ROLLUP = _versionAtReadInstant
  .toISOString()
  .replace('.123Z', '.987654+00:00');
const FIXTURE_EARNINGS_COMPUTED_AT = new Date(
  Date.now() - 2 * DAY_MS
).toISOString();

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
      queryFromActionable: mock(
        async (_id: string, _expectedUpdatedAt: string, note: string) => ({
          ...timesheet,
          gross_minor: 37_000,
          currency: 'GBP',
          earnings: computedEarnings,
          earnings_computed_at: FIXTURE_EARNINGS_COMPUTED_AT,
          status: 'queried',
          query_note: note,
        })
      ),
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
      makeEarnings(),
      makeEventRepo()
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
      insertMany: mock(async () => []),
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
    // ONE conditional write carries the status, the cleared approval stamp
    // and all four snapshot columns — the repository test pins the patch
    // itself, including that `query_note` is left alone. Display state on
    // the row (so a cold-start carer sees why pay moved) AND permanent
    // audit in the day-thread.
    expect(timesheetRepo.reopenFromApproved).toHaveBeenCalledWith(
      'ts1',
      approvedTimesheet.updated_at,
      'Thursday hours were wrong'
    );
    expect(timesheetRepo.update).not.toHaveBeenCalled();
    expect(reopened.approved_by).toBeNull();
    expect(reopened.approved_at).toBeNull();
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
    const timesheetRepo = makeTimesheetRepo();
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
      { insertMany: mock(async () => []) }
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
    const timesheetRepo = makeTimesheetRepo();
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
      { insertMany: mock(async () => []) }
    );

    const result = await svc.reopen('parent-1', 'ts1', {
      reason: 'missed break',
    });
    expect(result.status).toBe('submitted');
  });

  it('two reopens produce two append-only audit rows', async () => {
    const eventRepo = {
      insertMany: mock(async () => []),
    };
    // Both reads return approved — models parent re-approving between the
    // two undos. Each reopen appends its own day-thread row.
    const timesheetRepo = makeTimesheetRepo();
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
      insertMany: mock(async () => []),
    };
    const timesheetRepo = makeApprovingRepo();
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
    expect(timesheetRepo.reopenFromApproved).toHaveBeenCalledWith(
      'ts1',
      approvedTimesheet.updated_at,
      'Thursday was wrong'
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
// 1-E/P6 — `query` and `reopen` carry the same compare-and-set `approve` does.
//
// Both are decided against a row the service read a moment earlier, and both
// overwrite state a concurrent roll-up or approve can replace in between: a
// query written over a week that has since been approved silently un-approves
// it, and a reopen written over a week someone already reopened and
// re-approved clears a snapshot nobody was disputing. Status alone is not a
// version here for the same reason it is not one for approve.
//
// The lost race raises the error `assertActionable` would have raised had it
// noticed a few milliseconds later — same situation, later observation.
// =============================================================================

const submittedAtVersionForQuery = {
  ...timesheet,
  status: 'submitted',
  updated_at: VERSION_AT_READ,
};

const approvedAtVersion = {
  ...timesheet,
  status: 'approved',
  approved_by: 'parent-1',
  approved_at: '2026-08-04T18:00:00.000Z',
  gross_minor: 14_800,
  currency: 'GBP',
  earnings: { status: 'ok', gross_minor: 14_800 },
  earnings_computed_at: '2026-08-04T18:00:00.000Z',
  updated_at: VERSION_AT_READ,
};

function makeRacedSvc(
  timesheetRepo: any,
  owned: Record<string, unknown>,
  push: any = makePush()
) {
  return new TimesheetCommandService(
    makeTimeEntryRepo(),
    timesheetRepo,
    makeParentMemberRepo(),
    makeHouseholdRepo(),
    makeShiftRepo(),
    makeQueries({ getOwnedTimesheet: mock(async () => owned) }),
    makeUserService(),
    push,
    makeEarnings(),
    { insertMany: mock(async () => []) }
  );
}

describe('TimesheetCommandService.query — the CAS carries the row version', () => {
  it('passes the `updated_at` of the row it read into the conditional write', async () => {
    const timesheetRepo = makeTimesheetRepo();
    const svc = makeRacedSvc(timesheetRepo, submittedAtVersionForQuery);

    await svc.query('parent-1', 'ts1', { note: 'Query Thursday' });

    expect(timesheetRepo.queryFromActionable).toHaveBeenCalledWith(
      'ts1',
      VERSION_AT_READ,
      'Query Thursday'
    );
  });

  it('throws not-actionable when the week moved between the read and the write', async () => {
    const push = makePush();
    const timesheetRepo = makeTimesheetRepo({
      queryFromActionable: mock(async () => null),
    });
    const svc = makeRacedSvc(timesheetRepo, submittedAtVersionForQuery, push);

    await expect(
      svc.query('parent-1', 'ts1', { note: 'Query Thursday' })
    ).rejects.toBeInstanceOf(TimesheetNotActionableError);
    // No write landed, so the carer must not be told her week was queried.
    expect(push.notifyUser).not.toHaveBeenCalled();
  });

  it('names the race as the reason, not the status it read', async () => {
    const svc = makeRacedSvc(
      makeTimesheetRepo({ queryFromActionable: mock(async () => null) }),
      submittedAtVersionForQuery
    );

    await expect(
      svc.query('parent-1', 'ts1', { note: 'Query Thursday' })
    ).rejects.toMatchObject({ metadata: { status: 'changed_since_read' } });
  });
});

describe('TimesheetCommandService.reopen — the CAS carries the row version', () => {
  it('passes the `updated_at` of the row it read into the conditional write', async () => {
    const timesheetRepo = makeTimesheetRepo();
    const svc = makeRacedSvc(timesheetRepo, approvedAtVersion);

    await svc.reopen('parent-1', 'ts1', { reason: 'missed break' });

    expect(timesheetRepo.reopenFromApproved).toHaveBeenCalledWith(
      'ts1',
      VERSION_AT_READ,
      'missed break'
    );
  });

  it('throws not-actionable when the week moved between the read and the write', async () => {
    const push = makePush();
    const timesheetRepo = makeTimesheetRepo({
      reopenFromApproved: mock(async () => null),
    });
    const svc = makeRacedSvc(timesheetRepo, approvedAtVersion, push);

    await expect(
      svc.reopen('parent-1', 'ts1', { reason: 'missed break' })
    ).rejects.toBeInstanceOf(TimesheetNotActionableError);
    expect(push.notifyUser).not.toHaveBeenCalled();
  });

  it('names the race as the reason, not the status it read', async () => {
    const svc = makeRacedSvc(
      makeTimesheetRepo({ reopenFromApproved: mock(async () => null) }),
      approvedAtVersion
    );

    await expect(
      svc.reopen('parent-1', 'ts1', { reason: 'missed break' })
    ).rejects.toMatchObject({ metadata: { status: 'changed_since_read' } });
  });

  it('leaves the day-thread untouched when the reopen never landed', async () => {
    const eventRepo = { insertMany: mock(async () => []) };
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({ reopenFromApproved: mock(async () => null) }),
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({ getOwnedTimesheet: mock(async () => approvedAtVersion) }),
      makeUserService(),
      makePush(),
      makeEarnings(),
      eventRepo
    );

    await expect(
      svc.reopen('parent-1', 'ts1', { reason: 'missed break' })
    ).rejects.toBeInstanceOf(TimesheetNotActionableError);
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 1-E/P10 — a query is a money-visible act too, so it leaves the same kind of
// append-only day-thread row a reopen does. Write-only audit today; the week
// thread surfaces it later. Best-effort, exactly like the reopen row: the
// query write has already succeeded by then and must not be undone for a
// logging failure.
// =============================================================================

describe('TimesheetCommandService.query — the day-thread audit row', () => {
  it('appends a timesheet_queried event against the queried week', async () => {
    const eventRepo = { insertMany: mock(async () => []) };
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      makeEarnings(),
      eventRepo
    );

    await svc.query('parent-1', 'ts1', { note: 'Query Thursday' });

    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      {
        household_id: 'h1',
        shift_id: null,
        local_date: '2026-08-03',
        actor_id: 'parent-1',
        event_type: 'timesheet_queried',
        payload: {
          timesheetId: 'ts1',
          note: 'Query Thursday',
          weekStart: '2026-08-03',
        },
      },
    ]);
  });

  it('still queries the week and pushes the carer when the day-thread append throws', async () => {
    const push = makePush();
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      push,
      makeEarnings(),
      {
        insertMany: mock(async () => {
          throw new Error('day thread down');
        }),
      }
    );

    const queried = await svc.query('parent-1', 'ts1', {
      note: 'Query Thursday',
    });

    expect(queried.status).toBe('queried');
    expect(timesheetRepo.queryFromActionable).toHaveBeenCalled();
    expect(push.notifyUser).toHaveBeenCalledTimes(1);
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
      listOverlapCandidatesForCarer: mock(async () => [existingCompleted]),
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
      listOverlapCandidatesForCarer: mock(async () => [submittedEntry]),
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
      listOverlapCandidatesForCarer: mock(async () => [submittedEntry, other]),
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
      ...submittedEntry,
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
      listOverlapCandidatesForCarer: mock(async () => [
        otherCompleted,
        runningLater,
      ]),
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
      ...submittedEntry,
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
      listOverlapCandidatesForCarer: mock(async () => [
        priorCompleted,
        finishedAfter,
      ]),
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

// =============================================================================
// F-B1-2 / F-B1-4 / F-B1-1 / F-B2-4 — the money paths that silently lose or
// double-count minutes because a WEEK/ZONE was derived twice and disagreed.
// =============================================================================

describe('recordCancellationPaidEntry — the persisted timezone (F-B1-2)', () => {
  // household-local Mon 02:30 (week 2026-08-03), but shift-local Sun 18:30.
  // `local_date` is trigger-derived from the row's own `timezone` column, and
  // `listForCarerWeek` filters purely on `local_date` — stamping the shift
  // zone files these paid minutes into 2026-08-02, outside the week the guard
  // and the roll-up both used, so they vanish from total_minutes AND earnings.
  const divergentShift = {
    id: 's1',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-03T01:30:00.000Z',
    ends_at: '2026-08-03T09:30:00.000Z',
    timezone: 'America/Los_Angeles',
    cancellation_paid: true,
  };

  it('stamps the HOUSEHOLD timezone on the inserted row, not shift.timezone', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => null),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
      })),
      listForCarerWeek: mock(async () => []),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(), // Europe/London
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );

    await svc.recordCancellationPaidEntry(divergentShift);

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Europe/London' })
    );
  });
});

describe('TimesheetCommandService.rollUpIntoTimesheet — bucket by the frozen local_date (F-B1-4)', () => {
  it('buckets by the entry own local_date, not by re-deriving the week from the CURRENT household timezone', async () => {
    // The household PATCHed its timezone after this entry was written. Nothing
    // rewrites `time_entries.local_date` (the trigger only fires on clock /
    // timezone column updates), so re-deriving the bucket from the new zone
    // sums a week whose `local_date` filter excludes the very entry that
    // triggered the roll-up.
    const frozen = {
      ...runningEntry,
      clock_in_at: '2026-08-02T22:00:00.000Z',
      local_date: '2026-08-02', // frozen under Europe/London -> week 2026-07-27
    };
    // This session also crosses Monday in its FROZEN zone, so it splits (C6)
    // — which is the point: fragment A must still bucket by the entry's own
    // `local_date`, not by the household's new timezone.
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => []),
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...frozen,
        ...patch,
      })),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...frozen,
        ...data,
        id: 't-fragment-b',
        local_date: '2026-08-03',
      })),
    });
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      // UTC+12: the same instant is now Mon 2026-08-03 local -> week 2026-08-03
      makeHouseholdRepo({
        findById: mock(async () => ({
          id: 'h1',
          timezone: 'Pacific/Auckland',
        })),
      }),
      makeShiftRepo(),
      makeQueries({ getOwnedTimeEntry: mock(async () => frozen) }),
      makeUserService(),
      makePush()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-03T05:00:00.000Z',
    });

    expect(timeEntryRepo.listForCarerWeek).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-07-27',
      '2026-08-03'
    );
    expect(timesheetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ week_start: '2026-07-27' })
    );
  });
});

describe('TimesheetCommandService — overlap beyond one week (F-B1-1)', () => {
  // Sun 23:00 -> Mon 06:00 in Europe/London. `local_date` is frozen at the
  // clock-in day, so a week-filtered lookup for 2026-08-03 cannot see it at
  // all — both entries persisted, both summed, 60 minutes counted twice.
  const overnightPriorWeek = {
    ...submittedEntry,
    id: 't-overnight',
    clock_in_at: '2026-08-02T22:00:00.000Z',
    clock_out_at: '2026-08-03T05:00:00.000Z',
    local_date: '2026-08-02',
  };

  it('rejects a retroactive entry overlapping one filed under the PREVIOUS week', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [overnightPriorWeek]),
      listForCarerWeek: mock(async () => []), // the week view cannot see it
      createSubmitted: mock(async () => {
        throw new Error('createSubmitted must not be called on overlap');
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
      makeQueries(),
      makeUserService(),
      makePush()
    );

    const err = await svc
      .createRetroactiveEntry('carer-1', {
        household_id: 'h1',
        clock_in_at: '2026-08-03T01:00:00.000Z',
        clock_out_at: '2026-08-03T03:00:00.000Z',
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TimeEntryOverlapError);
    // Carer-scoped, not household-scoped: she cannot be in two places at
    // once, and the running-entry index agrees (keyed on carer_id alone).
    expect(timeEntryRepo.listOverlapCandidatesForCarer).toHaveBeenCalledWith(
      'carer-1',
      '2026-08-03T01:00:00.000Z',
      '2026-08-03T03:00:00.000Z'
    );
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('rejects a retroactive entry that swallows a still-RUNNING session', async () => {
    const running = {
      ...runningEntry,
      id: 't-running',
      clock_in_at: '2026-08-03T09:00:00.000Z',
      clock_out_at: null,
    };
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [running]),
      listForCarerWeek: mock(async () => [running]),
      createSubmitted: mock(async () => {
        throw new Error('createSubmitted must not be called on overlap');
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
      makeQueries(),
      makeUserService(),
      makePush()
    );

    const err = await svc
      .createRetroactiveEntry('carer-1', {
        household_id: 'h1',
        clock_in_at: '2026-08-03T08:00:00.000Z',
        clock_out_at: '2026-08-03T12:00:00.000Z',
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TimeEntryOverlapError);
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('still allows a retroactive entry that merely PRECEDES a running session', async () => {
    // A running entry is not an infinite span: an earlier, finished session
    // recorded before the carer clocked in is ordinary, and rejecting it would
    // break forgotten-clock-in recovery while she is on the clock.
    const running = {
      ...runningEntry,
      id: 't-running',
      clock_in_at: '2026-08-03T16:00:00.000Z',
      clock_out_at: null,
    };
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [running]),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
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
      makeQueries(),
      makeUserService(),
      makePush()
    );

    await svc.createRetroactiveEntry('carer-1', {
      household_id: 'h1',
      clock_in_at: '2026-08-03T08:00:00.000Z',
      clock_out_at: '2026-08-03T12:00:00.000Z',
    });

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalled();
  });
});

describe('TimesheetCommandService.clockIn — never start inside an existing entry (F-B2-4)', () => {
  // A paid cancellation writes a full-span completed entry. Clocking in inside
  // it leaves a running row that can NEVER be clocked out (every clock-out
  // fails the overlap check) and that blocks every future clock-in via
  // `time_entries_one_running_per_carer`.
  const cancellationSpan = {
    ...submittedEntry,
    id: 't-cancel',
    kind: 'cancellation_paid',
    clock_in_at: '2026-08-03T09:00:00.000Z',
    clock_out_at: '2026-08-03T17:00:00.000Z',
  };

  it('rejects the clock-in rather than creating a permanently stuck running row', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [cancellationSpan]),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );

    const err = await svc
      .clockIn(
        'carer-1',
        { household_id: 'h1' },
        () => new Date('2026-08-03T12:00:00.000Z')
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TimeEntryOverlapError);
    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });

  it('allows a clock-in that starts exactly where a completed entry finishes', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [cancellationSpan]),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );

    await svc.clockIn(
      'carer-1',
      { household_id: 'h1' },
      () => new Date('2026-08-03T17:00:00.000Z')
    );

    expect(timeEntryRepo.clockIn).toHaveBeenCalled();
  });
});

describe('TimesheetCommandService.updateEntry — guard the week the roll-up will actually rewrite (F-B1-4)', () => {
  // Frozen under Europe/London: Sun 19:00-23:00, local_date 2026-08-02,
  // week 2026-07-27. The household has since PATCHed to Pacific/Auckland
  // (UTC+12), where the same instants read Mon 06:00-10:00 -> week
  // 2026-08-03. `local_date` was NOT rewritten, so the roll-up will still
  // recompute 2026-07-27 — and an approved-week guard that asks the live
  // zone checks a week nobody is about to touch.
  const frozen = {
    ...submittedEntry,
    id: 't-frozen',
    clock_in_at: '2026-08-02T18:00:00.000Z',
    clock_out_at: '2026-08-02T22:00:00.000Z',
    local_date: '2026-08-02',
    timezone: 'Europe/London',
    status: 'submitted',
  };

  it('refuses an edit on an APPROVED week that the live household zone would have missed', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => []),
      update: mock(async () => {
        throw new Error('update must not be called on an approved week');
      }),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async (_h: string, _c: string, weekStart: string) =>
        weekStart === '2026-07-27'
          ? { ...timesheet, week_start: '2026-07-27', status: 'approved' }
          : null
      ),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo({
        findById: mock(async () => ({
          id: 'h1',
          timezone: 'Pacific/Auckland',
        })),
      }),
      makeShiftRepo(),
      makeQueries({ getOwnedTimeEntry: mock(async () => frozen) }),
      makeUserService(),
      makePush()
    );

    await expect(
      svc.updateEntry('carer-1', 't-frozen', { break_minutes: 15 })
    ).rejects.toBeInstanceOf(TimeEntryNotEditableError);
    expect(timesheetRepo.findByWeek).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-07-27'
    );
  });
});

// =============================================================================
// F-B2-4 / F-B1-1c reopened: a running row that can NEVER be clocked out is
// worse than the bug it replaced — `time_entries_one_running_per_carer` is
// indexed on carer_id ALONE, so one stranded row locks the carer out of every
// household she works for, with no self-service recovery.
// =============================================================================

describe('recordCancellationPaidEntry — never strand a running session (F-B2-4)', () => {
  const paidSpanShift = {
    id: 's-cancel',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-03T08:00:00.000Z',
    ends_at: '2026-08-03T16:00:00.000Z',
    timezone: 'Europe/London',
    cancellation_paid: true,
  };

  function makeSvc(timeEntryRepo: any) {
    return new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );
  }

  function workedEntry(id: string, from: string, to: string | null) {
    return {
      ...submittedEntry,
      id,
      clock_in_at: `2026-08-03T${from}:00:00.000Z`,
      clock_out_at: to === null ? null : `2026-08-03T${to}:00:00.000Z`,
    };
  }

  function repoWith(candidates: unknown[]) {
    return makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => null),
      listOverlapCandidatesForCarer: mock(async () => candidates),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
      })),
    });
  }

  it('trims to the remainder when worked time sits at the START of the window', async () => {
    // She worked 08:00-09:00, then the shift was cancelled for the rest.
    // Cancellation pay means she is paid for the time that WAS cancelled.
    const timeEntryRepo = repoWith([workedEntry('t-worked', '08', '09')]);

    await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        clock_in_at: '2026-08-03T09:00:00.000Z',
        clock_out_at: '2026-08-03T16:00:00.000Z',
        scheduled_minutes: 420,
        kind: 'cancellation_paid',
      })
    );
  });

  it('trims to the remainder when worked time sits at the END of the window', async () => {
    const timeEntryRepo = repoWith([workedEntry('t-worked', '15', '16')]);

    await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        clock_in_at: '2026-08-03T08:00:00.000Z',
        clock_out_at: '2026-08-03T15:00:00.000Z',
        scheduled_minutes: 420,
      })
    );
  });

  it('writes NOTHING when she worked the whole window — no remainder to compensate', async () => {
    const timeEntryRepo = repoWith([workedEntry('t-worked', '08', '16')]);

    const result =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(result).toEqual([]);
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('trims against a RUNNING session as open-ended — the remainder ends where she clocked in', async () => {
    // Her finish is unknown. Ending the cancellation exactly where the
    // running session began is safe for EVERY later clock-out: whenever she
    // stops, her worked span starts at 11:00 and cannot reach back into it.
    const timeEntryRepo = repoWith([workedEntry('t-running', '11', null)]);

    await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        clock_in_at: '2026-08-03T08:00:00.000Z',
        clock_out_at: '2026-08-03T11:00:00.000Z',
        scheduled_minutes: 180,
      })
    );
  });

  it('writes NOTHING when a running session already covers the whole window', async () => {
    // Clocked in at the window start with no finish — open-ended, so there
    // is no remainder. Writing anything here is what stranded the row.
    const timeEntryRepo = repoWith([workedEntry('t-running', '08', null)]);

    const result =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(result).toEqual([]);
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('never double-banks: worked minutes + cancellation minutes equal the booked span exactly', async () => {
    // sumWorkedMinutes and the earnings engine both add `worked` and
    // `cancellation_paid` kinds. Trimming is only correct if the two never
    // cover the same minute — pin the arithmetic end to end.
    const workedIn = '2026-08-03T08:00:00.000Z';
    const workedOut = '2026-08-03T09:00:00.000Z';
    const timeEntryRepo = repoWith([
      {
        ...submittedEntry,
        id: 't-worked',
        clock_in_at: workedIn,
        clock_out_at: workedOut,
      },
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    // Narrow for real rather than asserting past it — if the service stopped
    // writing an entry, this test must fail loudly, not compute NaN.
    const fragment = created[0];
    if (!fragment?.clock_in_at || !fragment.clock_out_at) {
      throw new Error('expected a trimmed cancellation entry');
    }
    const workedMinutes = computeWorkedMinutes(workedIn, workedOut, 0);
    const cancelledMinutes = computeWorkedMinutes(
      fragment.clock_in_at,
      fragment.clock_out_at,
      0
    );
    const bookedMinutes =
      (new Date(paidSpanShift.ends_at).getTime() -
        new Date(paidSpanShift.starts_at).getTime()) /
      60_000;

    expect(workedMinutes).toBe(60);
    expect(cancelledMinutes).toBe(420);
    expect(workedMinutes + cancelledMinutes).toBe(bookedMinutes);
  });

  it('still writes the paid-cancel entry when nothing collides', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      findCancellationPaidForShift: mock(async () => null),
      listOverlapCandidatesForCarer: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
      })),
      listForCarerWeek: mock(async () => []),
    });

    const result =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(result[0]?.kind).toBe('cancellation_paid');
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledTimes(1);
  });
});

describe('TimesheetCommandService — a running entry is open-ended, not an instant (F-B1-1c)', () => {
  const running = {
    ...runningEntry,
    id: 't-running',
    clock_in_at: '2026-08-03T09:00:00.000Z',
    clock_out_at: null,
  };

  it('rejects a retroactive entry that starts AFTER a running session began', async () => {
    // She clocked in 09:00 and forgot. Filing 14:00-17:00 sits entirely
    // after that start, so an instant-shaped running span misses it — then
    // every clock-out of the 09:00 row throws forever.
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [running]),
      createSubmitted: mock(async () => {
        throw new Error('createSubmitted must not be called on overlap');
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
      makeQueries(),
      makeUserService(),
      makePush()
    );

    const err = await svc
      .createRetroactiveEntry('carer-1', {
        household_id: 'h1',
        clock_in_at: '2026-08-03T14:00:00.000Z',
        clock_out_at: '2026-08-03T17:00:00.000Z',
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TimeEntryOverlapError);
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('still allows a retroactive entry that FINISHES at or before the running start', async () => {
    // The one legitimate exception: a session that ended before she clocked
    // in. Touching end-to-start stays allowed, same as two finished spans.
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [running]),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
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
      makeQueries(),
      makeUserService(),
      makePush()
    );

    await svc.createRetroactiveEntry('carer-1', {
      household_id: 'h1',
      clock_in_at: '2026-08-03T05:00:00.000Z',
      clock_out_at: '2026-08-03T09:00:00.000Z',
    });

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalled();
  });
});

describe('recordCancellationPaidEntry — split remainder (053)', () => {
  const paidSpanShift = {
    id: 's-cancel',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-03T08:00:00.000Z',
    ends_at: '2026-08-03T16:00:00.000Z',
    timezone: 'Europe/London',
    cancellation_paid: true,
  };

  function at(hour: string) {
    return `2026-08-03T${hour}:00:00.000Z`;
  }

  function repoWith(
    candidates: unknown[],
    overrides: Record<string, unknown> = {}
  ) {
    return makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => candidates),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
      })),
      ...overrides,
    });
  }

  function makeSvc(timeEntryRepo: any) {
    return new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );
  }

  it('pays BOTH remainders when worked time sits in the middle', async () => {
    // She worked 11:00-12:00 of an 08:00-16:00 cancelled shift. 053 keys the
    // unique index on (shift_id, clock_in_at), so both fragments are legal
    // rows and she is owed 08:00-11:00 AND 12:00-16:00 — not one of them,
    // and not nothing.
    const timeEntryRepo = repoWith([
      {
        ...submittedEntry,
        id: 't-worked',
        clock_in_at: at('11'),
        clock_out_at: at('12'),
      },
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(created).toHaveLength(2);
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledTimes(2);
    expect(timeEntryRepo.createSubmitted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        clock_in_at: at('08'),
        clock_out_at: at('11'),
        scheduled_minutes: 180,
      })
    );
    expect(timeEntryRepo.createSubmitted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        clock_in_at: at('12'),
        clock_out_at: at('16'),
        scheduled_minutes: 240,
      })
    );
  });

  it('never double-banks across a SPLIT: worked + both fragments equal the booked span', async () => {
    const timeEntryRepo = repoWith([
      {
        ...submittedEntry,
        id: 't-worked',
        clock_in_at: at('11'),
        clock_out_at: at('12'),
      },
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    const cancelled = created.reduce((total, entry) => {
      if (!entry.clock_in_at || !entry.clock_out_at) {
        throw new Error('every fragment must be a finished span');
      }
      return (
        total + computeWorkedMinutes(entry.clock_in_at, entry.clock_out_at, 0)
      );
    }, 0);
    const worked = computeWorkedMinutes(at('11'), at('12'), 0);
    const booked =
      (new Date(paidSpanShift.ends_at).getTime() -
        new Date(paidSpanShift.starts_at).getTime()) /
      60_000;

    expect(worked).toBe(60);
    expect(cancelled).toBe(420); // 180 + 240
    expect(worked + cancelled).toBe(booked);
  });

  it('writes only the MISSING fragment after a partial failure — retry is safe', async () => {
    // Fragment 1 committed, fragment 2 failed. There are no multi-statement
    // transactions here, so the repair path is a plain re-call: the already
    // written row is now a candidate and is excluded from the remainder.
    const timeEntryRepo = repoWith([
      {
        ...submittedEntry,
        id: 't-worked',
        clock_in_at: at('11'),
        clock_out_at: at('12'),
      },
      {
        ...submittedEntry,
        id: 't-cancel-1',
        kind: 'cancellation_paid',
        clock_in_at: at('08'),
        clock_out_at: at('11'),
        // What the write path actually stores for this fragment. Inheriting
        // `submittedEntry`'s 480 would claim the whole window for three
        // hours, and C7's budget arithmetic reads this column.
        scheduled_minutes: 180,
      },
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(created).toHaveLength(1);
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledTimes(1);
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ clock_in_at: at('12'), clock_out_at: at('16') })
    );
  });

  it('recovers the row for the SPAN it lost, not just the shift (23505)', async () => {
    // Concurrent accepts both compute the same two fragments. The loser must
    // re-fetch the fragment it tried to write — a shift-wide lookup could
    // hand back the other fragment entirely.
    const winner = {
      ...submittedEntry,
      id: 't-raced',
      kind: 'cancellation_paid',
      clock_in_at: at('08'),
      clock_out_at: at('11'),
    };
    const timeEntryRepo = repoWith(
      [
        {
          ...submittedEntry,
          id: 't-worked',
          clock_in_at: at('11'),
          clock_out_at: at('12'),
        },
      ],
      {
        createSubmitted: mock(async (data: Record<string, unknown>) => {
          if (data.clock_in_at === at('08')) {
            throw new CancellationPaidAlreadyRecordedError('s-cancel');
          }
          return { ...submittedEntry, ...data };
        }),
        findCancellationPaidForSpan: mock(async () => winner),
      }
    );

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(timeEntryRepo.findCancellationPaidForSpan).toHaveBeenCalledWith(
      's-cancel',
      at('08')
    );
    expect(created.map(e => e.id)).toEqual(['t-raced', 't1']);
  });

  it('returns [] once every fragment is already recorded', async () => {
    const timeEntryRepo = repoWith([
      {
        ...submittedEntry,
        id: 't-cancel-1',
        kind: 'cancellation_paid',
        clock_in_at: at('08'),
        clock_out_at: at('16'),
      },
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(created).toEqual([]);
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });
});

describe('recordCancellationPaidEntry — approved-week guard covers EVERY fragment', () => {
  // Europe/London window Sun 20:00 -> Mon 08:00 local, so the two fragments
  // land in DIFFERENT weeks. Week A (2026-07-27) is open; week B (2026-08-03)
  // is approved. Guarding only the start's week lets fragment 2 through, and
  // `rollUpIntoTimesheet` then un-approves week B unconditionally — status
  // back to submitted with the frozen gross nulled.
  const overnightShift = {
    id: 's-overnight',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-02T19:00:00.000Z', // Sun 20:00 London
    ends_at: '2026-08-03T07:00:00.000Z', // Mon 08:00 London
    timezone: 'Europe/London',
    cancellation_paid: true,
  };

  function makeSvc(timeEntryRepo: any, timesheetRepo: any) {
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

  it('refuses when the SECOND fragment lands on an approved week', async () => {
    // Worked Sun 22:00 -> Mon 02:00 (21:00Z -> 01:00Z), so the remainders are
    // 19:00-21:00Z (week 2026-07-27) and 01:00-07:00Z (week 2026-08-03).
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [
        {
          ...submittedEntry,
          id: 't-worked',
          clock_in_at: '2026-08-02T21:00:00.000Z',
          clock_out_at: '2026-08-03T01:00:00.000Z',
        },
      ]),
      createSubmitted: mock(async () => {
        throw new Error(
          'createSubmitted must not be called for an approved week'
        );
      }),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async (_h: string, _c: string, weekStart: string) =>
        weekStart === '2026-08-03'
          ? { ...timesheet, week_start: '2026-08-03', status: 'approved' }
          : { ...timesheet, week_start: weekStart, status: 'submitted' }
      ),
    });

    await expect(
      makeSvc(timeEntryRepo, timesheetRepo).recordCancellationPaidEntry(
        overnightShift
      )
    ).rejects.toBeInstanceOf(TimeEntryNotEditableError);
    // Nothing written at all — not even the fragment whose own week was open.
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('writes both fragments when NEITHER week is approved', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [
        {
          ...submittedEntry,
          id: 't-worked',
          clock_in_at: '2026-08-02T21:00:00.000Z',
          clock_out_at: '2026-08-03T01:00:00.000Z',
        },
      ]),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
      })),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });

    const created = await makeSvc(
      timeEntryRepo,
      timesheetRepo
    ).recordCancellationPaidEntry(overnightShift);

    expect(created).toHaveLength(2);
  });
});

describe('recordCancellationPaidEntry — a lost fragment is never silent', () => {
  it('throws rather than dropping a fragment whose 23505 winner cannot be found', async () => {
    // The winner's transaction rolled back between the unique violation and
    // the re-fetch: the row does not exist and we did not write it. Returning
    // null here loses the money with no error, no log and no roll-up.
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => []),
      createSubmitted: mock(async () => {
        throw new CancellationPaidAlreadyRecordedError('s-cancel');
      }),
      findCancellationPaidForSpan: mock(async () => null),
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
      makeUserService(),
      makePush()
    );

    await expect(
      svc.recordCancellationPaidEntry({
        id: 's-cancel',
        household_id: 'h1',
        carer_id: 'carer-1',
        starts_at: '2026-08-03T08:00:00.000Z',
        ends_at: '2026-08-03T16:00:00.000Z',
        timezone: 'Europe/London',
        cancellation_paid: true,
      })
    ).rejects.toBeInstanceOf(CancellationPaidAlreadyRecordedError);
  });
});

describe('cancellation pay is scoped to the cancelling household', () => {
  const shiftA = {
    id: 's-a',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-03T08:00:00.000Z',
    ends_at: '2026-08-03T16:00:00.000Z',
    timezone: 'Europe/London',
    cancellation_paid: true,
  };
  // She is on the clock for a DIFFERENT family across most of A's window.
  const workedAtB = {
    ...submittedEntry,
    id: 't-b-worked',
    household_id: 'h2',
    kind: 'worked',
    clock_in_at: '2026-08-03T07:00:00.000Z',
    clock_out_at: '2026-08-03T12:00:00.000Z',
  };

  it('household A owes the FULL booked window even while she works for B', async () => {
    // A is compensating the booking A broke. What she did for B is not A's
    // credit to take, and subtracting it made her pay depend on when the
    // reconcile job happened to run.
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [workedAtB]),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
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
      makeQueries(),
      makeUserService(),
      makePush()
    );

    const created = await svc.recordCancellationPaidEntry(shiftA);

    expect(created).toHaveLength(1);
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        clock_in_at: '2026-08-03T08:00:00.000Z',
        clock_out_at: '2026-08-03T16:00:00.000Z',
        scheduled_minutes: 480,
      })
    );
  });

  it('still trims against THIS household own worked time — the double-bank stays refused', async () => {
    const workedAtA = {
      ...workedAtB,
      id: 't-a-worked',
      household_id: 'h1',
      clock_in_at: '2026-08-03T08:00:00.000Z',
      clock_out_at: '2026-08-03T09:00:00.000Z',
    };
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [workedAtA, workedAtB]),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
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
      makeQueries(),
      makeUserService(),
      makePush()
    );

    await svc.recordCancellationPaidEntry(shiftA);

    // Trimmed by h1's hour only; h2's five hours are irrelevant to h1's debt.
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        clock_in_at: '2026-08-03T09:00:00.000Z',
        clock_out_at: '2026-08-03T16:00:00.000Z',
        scheduled_minutes: 420,
      })
    );
  });
});

describe('TimesheetCommandService.clockIn — a cancellation is not time on the clock', () => {
  function svcWith(candidates: unknown[]) {
    return new TimesheetCommandService(
      makeTimeEntryRepo({
        listOverlapCandidatesForCarer: mock(async () => candidates),
      }),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );
  }

  const span = {
    ...submittedEntry,
    clock_in_at: '2026-08-03T09:00:00.000Z',
    clock_out_at: '2026-08-03T17:00:00.000Z',
  };
  const at12 = () => new Date('2026-08-03T12:00:00.000Z');

  it('ALLOWS clocking in for B inside a cancellation A is paying for', async () => {
    // A cancelled and owes her the window; she is free to work for B in it.
    const svc = svcWith([
      {
        ...span,
        id: 't-a-cancel',
        household_id: 'h2',
        kind: 'cancellation_paid',
      },
    ]);
    const entry = await svc.clockIn('carer-1', { household_id: 'h1' }, at12);
    expect(entry).toBeTruthy();
  });

  it('REFUSES clocking in inside THIS household own cancellation — double-bank', async () => {
    const svc = svcWith([
      {
        ...span,
        id: 't-own-cancel',
        household_id: 'h1',
        kind: 'cancellation_paid',
      },
    ]);
    const err = await svc
      .clockIn('carer-1', { household_id: 'h1' }, at12)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeEntryOverlapError);
  });

  it('REFUSES clocking in while already working for another household', async () => {
    const svc = svcWith([
      { ...span, id: 't-b-worked', household_id: 'h2', kind: 'worked' },
    ]);
    const err = await svc
      .clockIn('carer-1', { household_id: 'h1' }, at12)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeEntryOverlapError);
  });
});

describe('recordCancellationPaidEntry — round ONCE against the window (C7)', () => {
  // The window is booked in whole minutes; the worked block inside it is not.
  // Rounding each piece independently loses or invents up to a minute per
  // boundary — the drift the old ponytail comment measured at ~£0.25/shift.
  // Now the window is rounded once and the LAST fragment carries the
  // residual, so `worked + Σ fragments === booked` exactly.
  const paidSpanShift = {
    id: 's-cancel',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-03T08:00:00.000Z',
    ends_at: '2026-08-03T16:00:00.000Z', // 480 booked minutes
    timezone: 'Europe/London',
    cancellation_paid: true,
  };

  function repoWith(candidates: unknown[]) {
    return makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => candidates),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
      })),
    });
  }

  function makeSvc(timeEntryRepo: any) {
    return new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );
  }

  function worked(clockInAt: string, clockOutAt: string | null) {
    return {
      ...submittedEntry,
      id: 't-worked',
      break_minutes: 0,
      scheduled_minutes: null,
      clock_in_at: clockInAt,
      clock_out_at: clockOutAt,
    };
  }

  /** Presence + every fragment written, in the banked (C7) formula. */
  function banked(created: readonly any[], workedMinutes: number): number {
    return created.reduce(
      (total, entry) => total + (entry.scheduled_minutes as number),
      workedMinutes
    );
  }

  it('conserves the booked window when a MIDDLE block rounds DOWN (the 479 case)', async () => {
    // 11:00:20-12:00:40 worked -> 60. Independently rounded, the two
    // remainders give 180 + 239 = 419, and 60 + 419 = 479 for a 480 window.
    const timeEntryRepo = repoWith([
      worked('2026-08-03T11:00:20.000Z', '2026-08-03T12:00:40.000Z'),
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(created.map(e => e.scheduled_minutes)).toEqual([180, 240]);
    expect(banked(created, 60)).toBe(480);
  });

  it('conserves the booked window when a MIDDLE block rounds UP (the 481 case)', async () => {
    // 11:00:31-12:00:29 worked -> 60; independent rounding gives 181 + 240.
    const timeEntryRepo = repoWith([
      worked('2026-08-03T11:00:31.000Z', '2026-08-03T12:00:29.000Z'),
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(created.map(e => e.scheduled_minutes)).toEqual([181, 239]);
    expect(banked(created, 60)).toBe(480);
  });

  it('conserves the booked window on the half-minute tie (the 08:00:00-09:00:30 case)', async () => {
    // Math.round goes half-up on BOTH sides: 60.5 -> 61 worked and 419.5 ->
    // 420 remaining, i.e. 481 for a 480 window. The single fragment is the
    // last one, so it carries the whole residual.
    const timeEntryRepo = repoWith([
      worked('2026-08-03T08:00:00.000Z', '2026-08-03T09:00:30.000Z'),
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(created.map(e => e.scheduled_minutes)).toEqual([419]);
    expect(banked(created, 61)).toBe(480);
  });

  it('gives a retry the SAME residual a full run would have written', async () => {
    // The reconcile job re-runs after fragment 1 committed and fragment 2
    // did not. The surviving row's STORED minutes are what make this
    // deterministic: re-deriving them from its span would hand the rewritten
    // fragment a different number than the full run produced.
    const timeEntryRepo = repoWith([
      worked('2026-08-03T11:00:20.000Z', '2026-08-03T12:00:40.000Z'),
      {
        ...submittedEntry,
        id: 't-cancel-1',
        kind: 'cancellation_paid',
        break_minutes: 0,
        clock_in_at: '2026-08-03T08:00:00.000Z',
        clock_out_at: '2026-08-03T11:00:20.000Z',
        scheduled_minutes: 180,
      },
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(created.map(e => e.scheduled_minutes)).toEqual([240]);
    expect(banked(created, 60) + 180).toBe(480);
  });

  it('gives the SAME first fragment back when it is the RESIDUAL row that survived', async () => {
    // Mirror of the above: fragment 2 (the residual carrier, 240) survived
    // and fragment 1 is missing. Re-rounding the survivor's span would give
    // 239 here and hand fragment 1 a 181 it never had.
    const timeEntryRepo = repoWith([
      worked('2026-08-03T11:00:20.000Z', '2026-08-03T12:00:40.000Z'),
      {
        ...submittedEntry,
        id: 't-cancel-2',
        kind: 'cancellation_paid',
        break_minutes: 0,
        clock_in_at: '2026-08-03T12:00:40.000Z',
        clock_out_at: '2026-08-03T16:00:00.000Z',
        scheduled_minutes: 240,
      },
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(created.map(e => e.scheduled_minutes)).toEqual([180]);
    expect(banked(created, 60) + 240).toBe(480);
  });

  it('never over-assigns when several sub-minute gaps each round up', async () => {
    // Found by the randomized conservation sweep. Four 31-second gaps each
    // round to a minute on their own — more than the window has left once the
    // four 31-second worked blocks have taken their own rounded minutes. Left
    // uncapped, the first three fragments claim a minute each and the last is
    // handed a negative it clamps to zero, paying the window twice over.
    const second = (n: number) =>
      new Date(Date.UTC(2026, 7, 3, 8, 0, n)).toISOString();
    const shiftSpan = {
      ...paidSpanShift,
      starts_at: second(0),
      ends_at: second(248), // 4 booked minutes
    };
    const timeEntryRepo = repoWith([
      { ...worked(second(31), second(62)), id: 'w1' },
      { ...worked(second(93), second(124)), id: 'w2' },
      { ...worked(second(155), second(186)), id: 'w3' },
      { ...worked(second(217), second(248)), id: 'w4' },
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(shiftSpan);

    // Presence rounds to 4 minutes, which is the whole booked window: there
    // is nothing left to compensate.
    expect(created).toHaveLength(4);
    expect(created.map(e => e.scheduled_minutes)).toEqual([0, 0, 0, 0]);
  });

  it("does not pay a worked entry's unpaid break as cancellation time", async () => {
    // Presence is the SPAN, not span-minus-break: she was there for the whole
    // hour, so only the 420 minutes she was absent were cancelled. Topping up
    // her break would be money nobody agreed to.
    const timeEntryRepo = repoWith([
      {
        ...worked('2026-08-03T08:00:00.000Z', '2026-08-03T09:00:00.000Z'),
        break_minutes: 15,
      },
    ]);

    const created =
      await makeSvc(timeEntryRepo).recordCancellationPaidEntry(paidSpanShift);

    expect(created.map(e => e.scheduled_minutes)).toEqual([420]);
  });
});

describe('TimesheetCommandService.clockOut — a session that crosses Monday splits (C6)', () => {
  // A Sunday-night session that finishes on Monday is two weeks' work. Filing
  // all of it under the clock-IN's week overstates one timesheet and leaves
  // the other empty — and a parent approves a week that never contained
  // those hours. `rollUpIntoTimesheet` recomputes ONE week, so the split has
  // to happen at the write, not at the read.
  const CARER = 'carer-1';

  function running(over: Record<string, unknown> = {}) {
    return {
      ...runningEntry,
      id: 't1',
      shift_id: null,
      break_minutes: 0,
      clock_in_at: '2026-01-11T23:00:00.000Z', // Sun 23:00 London (GMT)
      local_date: '2026-01-11',
      timezone: 'Europe/London',
      ...over,
    };
  }

  function makeSvc(entry: Record<string, unknown>, repoOverrides: any = {}) {
    // `local_date` is trigger-derived from `clock_in_at` + `timezone`
    // (017_time_tracking.sql). The fake has to do the same or the roll-up
    // buckets the new fragment into the week it was written FROM.
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [entry]),
      listForCarerWeek: mock(async () => []),
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...entry,
        ...patch,
      })),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...entry,
        ...data,
        id: 't-fragment-b',
        local_date: localDateOf(
          new Date(data.clock_in_at as string),
          data.timezone as string
        ),
      })),
      ...repoOverrides,
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo({ findById: mock(async () => null) }),
      makeQueries({ getOwnedTimeEntry: mock(async () => entry) }),
      makeUserService(),
      makePush()
    );
    return { svc, timeEntryRepo };
  }

  it('splits at London-local Monday midnight in GMT', async () => {
    const entry = running({ shift_id: 'shift-x' });
    const { svc, timeEntryRepo } = makeSvc(entry);

    const returned = await svc.clockOut(CARER, 't1', {
      clock_out_at: '2026-01-12T02:00:00.000Z',
    });

    // Fragment B is inserted first, complete and submitted, keeping the shift.
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledTimes(1);
    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        clock_in_at: '2026-01-12T00:00:00.000Z',
        clock_out_at: '2026-01-12T02:00:00.000Z',
        kind: 'worked',
        status: 'submitted',
        shift_id: 'shift-x',
        household_id: 'h1',
      })
    );
    // Fragment A is the running row itself, closed at the boundary — it keeps
    // its id, so the client's reference stays valid.
    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        clock_out_at: '2026-01-12T00:00:00.000Z',
        status: 'submitted',
      })
    );
    expect(returned.id).toBe('t1');
    expect(returned.clock_out_at).toBe('2026-01-12T00:00:00.000Z');
  });

  it('rolls up BOTH weeks, not just the clock-in week', async () => {
    const entry = running();
    const { svc, timeEntryRepo } = makeSvc(entry);

    await svc.clockOut(CARER, 't1', {
      clock_out_at: '2026-01-12T02:00:00.000Z',
    });

    expect(timeEntryRepo.listForCarerWeek).toHaveBeenCalledTimes(2);
    expect(timeEntryRepo.listForCarerWeek).toHaveBeenNthCalledWith(
      1,
      'h1',
      CARER,
      '2026-01-05',
      '2026-01-12'
    );
    expect(timeEntryRepo.listForCarerWeek).toHaveBeenNthCalledWith(
      2,
      'h1',
      CARER,
      '2026-01-12',
      '2026-01-19'
    );
  });

  it('splits at 23:00Z when London is on BST', async () => {
    // Sun 2026-07-12 22:00Z is 23:00 local. Local Monday midnight is 23:00Z,
    // an hour before UTC midnight — a UTC-midnight boundary would file the
    // first local hour of Monday into Sunday's week.
    const entry = running({
      clock_in_at: '2026-07-12T22:00:00.000Z',
      local_date: '2026-07-12',
    });
    const { svc, timeEntryRepo } = makeSvc(entry);

    await svc.clockOut(CARER, 't1', {
      clock_out_at: '2026-07-13T01:00:00.000Z',
    });

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        clock_in_at: '2026-07-12T23:00:00.000Z',
        clock_out_at: '2026-07-13T01:00:00.000Z',
      })
    );
    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ clock_out_at: '2026-07-12T23:00:00.000Z' })
    );
  });

  it('does NOT split a session that finishes exactly at midnight', async () => {
    // Half-open: a session ending at the boundary is entirely in week A, and
    // a second fragment would be a zero-length row.
    const entry = running();
    const { svc, timeEntryRepo } = makeSvc(entry);

    await svc.clockOut(CARER, 't1', {
      clock_out_at: '2026-01-12T00:00:00.000Z',
    });

    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
    expect(timeEntryRepo.listForCarerWeek).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary same-week clock-out exactly as it was', async () => {
    const entry = running({
      clock_in_at: '2026-01-08T09:00:00.000Z',
      local_date: '2026-01-08',
    });
    const { svc, timeEntryRepo } = makeSvc(entry);

    const returned = await svc.clockOut(CARER, 't1', {
      clock_out_at: '2026-01-08T17:00:00.000Z',
    });

    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        clock_out_at: '2026-01-08T17:00:00.000Z',
        status: 'submitted',
      })
    );
    expect(returned.id).toBe('t1');
  });

  it('conserves worked minutes and the break across the split', async () => {
    // Real seconds on both ends, so each fragment rounds independently and
    // the pair must still add up to the session the carer actually worked.
    const entry = running({ clock_in_at: '2026-01-11T23:00:20.000Z' });
    const { svc, timeEntryRepo } = makeSvc(entry);

    await svc.clockOut(CARER, 't1', {
      clock_out_at: '2026-01-12T01:00:40.000Z',
      break_minutes: 30,
    });

    const fragmentA = timeEntryRepo.update.mock.calls[0][1];
    const fragmentB = timeEntryRepo.createSubmitted.mock.calls[0][0];
    const minutesA = computeWorkedMinutes(
      entry.clock_in_at as string,
      fragmentA.clock_out_at,
      fragmentA.break_minutes
    );
    const minutesB = computeWorkedMinutes(
      fragmentB.clock_in_at,
      fragmentB.clock_out_at,
      fragmentB.break_minutes
    );

    // 59m40s + 60m40s each round UP while the 120m20s whole rounds DOWN, so
    // the pair is a minute long. The drift is folded into the break total —
    // 31 recorded across two rows for a 30-minute break — because the minutes
    // she is PAID for are the number that must not move.
    expect(fragmentA.break_minutes + fragmentB.break_minutes).toBe(31);
    expect(minutesA + minutesB).toBe(
      computeWorkedMinutes(
        entry.clock_in_at as string,
        '2026-01-12T01:00:40.000Z',
        30
      )
    );
  });

  it('splits a frozen scheduled_minutes across the two fragments', async () => {
    const entry = running({ shift_id: 'shift-x' });
    const { svc, timeEntryRepo } = makeSvc(entry, {});
    // 3h session, a 180-minute booking: 60 to A, 120 to B, sum preserved.
    const svcWithShift = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo({
        findById: mock(async () => ({
          ...shift,
          starts_at: '2026-01-11T23:00:00.000Z',
          ends_at: '2026-01-12T02:00:00.000Z',
        })),
      }),
      makeQueries({ getOwnedTimeEntry: mock(async () => entry) }),
      makeUserService(),
      makePush()
    );
    void svc;

    await svcWithShift.clockOut(CARER, 't1', {
      clock_out_at: '2026-01-12T02:00:00.000Z',
    });

    expect(timeEntryRepo.update.mock.calls[0][1].scheduled_minutes).toBe(60);
    expect(
      timeEntryRepo.createSubmitted.mock.calls[0][0].scheduled_minutes
    ).toBe(120);
  });

  it('adopts a fragment B left behind by a crashed attempt instead of duplicating it', async () => {
    // Crash between the insert and the close: the carer taps Clock out again.
    // Inserting a second B would double-pay Monday morning.
    const entry = running();
    // PostgREST serializes timestamptz as `+00:00`, never `.000Z` — the
    // orphan comes back from the DB in that shape, and matching it as a
    // STRING against our own ISO output silently never fires.
    const orphan = {
      ...submittedEntry,
      id: 't-orphan-b',
      household_id: 'h1',
      kind: 'worked',
      break_minutes: 0,
      clock_in_at: '2026-01-12T00:00:00+00:00',
      clock_out_at: '2026-01-12T02:00:00+00:00',
      local_date: '2026-01-12',
    };
    const { svc, timeEntryRepo } = makeSvc(entry, {
      listOverlapCandidatesForCarer: mock(async () => [entry, orphan]),
    });

    const returned = await svc.clockOut(CARER, 't1', {
      clock_out_at: '2026-01-12T02:00:00.000Z',
    });

    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ clock_out_at: '2026-01-12T00:00:00.000Z' })
    );
    expect(returned.id).toBe('t1');
    expect(timeEntryRepo.listForCarerWeek).toHaveBeenCalledTimes(2);
  });

  it('adopts an orphan written with our own .000Z formatting too', async () => {
    const entry = running();
    const orphan = {
      ...submittedEntry,
      id: 't-orphan-b',
      household_id: 'h1',
      kind: 'worked',
      break_minutes: 0,
      clock_in_at: '2026-01-12T00:00:00.000Z',
      clock_out_at: '2026-01-12T02:00:00.000Z',
      local_date: '2026-01-12',
    };
    const { svc, timeEntryRepo } = makeSvc(entry, {
      listOverlapCandidatesForCarer: mock(async () => [entry, orphan]),
    });

    await svc.clockOut(CARER, 't1', {
      clock_out_at: '2026-01-12T02:00:00.000Z',
    });

    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('does not trip the overlap guard on its own two adjacent fragments', async () => {
    // The running row is in the candidate list (it is a real row), and A ends
    // exactly where B starts. Neither may be read as a collision.
    const entry = running();
    const { svc } = makeSvc(entry);

    await expect(
      svc.clockOut(CARER, 't1', { clock_out_at: '2026-01-12T02:00:00.000Z' })
    ).resolves.toBeTruthy();
  });
});

describe('recordCancellationPaidEntry — an overnight window splits at Monday too (C6)', () => {
  // A cancelled window is pure payout, so filing all of it under the START's
  // week is the same defect C6 fixed for worked sessions, with none of the
  // "at least she was there" ambiguity: minutes are priced at the wrong
  // week's arrangement and counted toward the wrong week's overtime.
  const overnight = {
    id: 's-overnight',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-01-11T22:00:00.000Z', // Sun 22:00 London (GMT)
    ends_at: '2026-01-12T06:00:00.000Z', // Mon 06:00 London
    timezone: 'Europe/London',
    cancellation_paid: true,
  };

  function repoWith(candidates: unknown[]) {
    return makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => candidates),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
        local_date: localDateOf(
          new Date(data.clock_in_at as string),
          data.timezone as string
        ),
      })),
    });
  }

  function makeSvc(timeEntryRepo: any, weekStatus: (w: string) => string) {
    return new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async (_h: string, _c: string, week: string) => ({
          ...timesheet,
          status: weekStatus(week),
        })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );
  }

  it('writes one row per week, each with its own local_date', async () => {
    const timeEntryRepo = repoWith([]);

    const created = await makeSvc(
      timeEntryRepo,
      () => 'submitted'
    ).recordCancellationPaidEntry(overnight);

    expect(created).toHaveLength(2);
    expect(
      created.map(e => [e.clock_in_at, e.scheduled_minutes, e.local_date])
    ).toEqual([
      ['2026-01-11T22:00:00.000Z', 120, '2026-01-11'],
      ['2026-01-12T00:00:00.000Z', 360, '2026-01-12'],
    ]);
    // The booked window is still conserved across the week split.
    expect(created.reduce((t, e) => t + (e.scheduled_minutes ?? 0), 0)).toBe(
      480
    );
  });

  it('rolls up BOTH weeks', async () => {
    const timeEntryRepo = repoWith([]);

    await makeSvc(timeEntryRepo, () => 'submitted').recordCancellationPaidEntry(
      overnight
    );

    expect(timeEntryRepo.listForCarerWeek).toHaveBeenCalledTimes(2);
    expect(timeEntryRepo.listForCarerWeek).toHaveBeenNthCalledWith(
      1,
      'h1',
      'carer-1',
      '2026-01-05',
      '2026-01-12'
    );
    expect(timeEntryRepo.listForCarerWeek).toHaveBeenNthCalledWith(
      2,
      'h1',
      'carer-1',
      '2026-01-12',
      '2026-01-19'
    );
  });

  it('REFUSES when the MONDAY week is already approved', async () => {
    // Guarding only each remainder's start week never consulted the Monday
    // week at all, so the write landed and `rollUpIntoTimesheet` silently
    // un-approved a week a parent had signed off, nulling the frozen gross.
    const timeEntryRepo = repoWith([]);
    const svc = makeSvc(timeEntryRepo, week =>
      week === '2026-01-12' ? 'approved' : 'submitted'
    );

    await expect(
      svc.recordCancellationPaidEntry(overnight)
    ).rejects.toBeInstanceOf(TimeEntryNotEditableError);
    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });
});

describe('recordCancellationPaidEntry — the residual is spread, not dumped on one row', () => {
  it('keeps every fragment within a minute of its own span', async () => {
    // Nine gaps of 30m30s separated by eight blocks of 10m30s: every piece
    // rounds UP, so a residual carried entirely by the last fragment leaves
    // it eight minutes short of the span printed next to it on the carer's
    // screen. Conservation was never the problem; the optics of one row
    // disagreeing with its own clock times are.
    const startMs = Date.UTC(2026, 0, 5, 8, 0, 0);
    const gapMs = 30 * 60_000 + 30_000;
    const blockMs = 10 * 60_000 + 30_000;
    const rows: unknown[] = [];
    let cursor = startMs;
    for (let i = 0; i < 8; i++) {
      cursor += gapMs;
      rows.push({
        ...submittedEntry,
        id: `w${i}`,
        break_minutes: 0,
        scheduled_minutes: null,
        timezone: 'UTC',
        clock_in_at: new Date(cursor).toISOString(),
        clock_out_at: new Date(cursor + blockMs).toISOString(),
      });
      cursor += blockMs;
    }
    const endMs = cursor + gapMs;

    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => rows),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo({
        findById: mock(async () => ({ id: 'h1', timezone: 'UTC' })),
      }),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );

    const created = await svc.recordCancellationPaidEntry({
      id: 's-many',
      household_id: 'h1',
      carer_id: 'carer-1',
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
      timezone: 'UTC',
      cancellation_paid: true,
    });

    expect(created).toHaveLength(9);
    for (const fragment of created) {
      const span = computeWorkedMinutes(
        fragment.clock_in_at ?? '',
        fragment.clock_out_at ?? '',
        0
      );
      expect(Math.abs((fragment.scheduled_minutes ?? 0) - span)).toBeLessThan(
        2
      );
    }
    // Still exact overall.
    const presence = 8 * 11;
    expect(
      created.reduce((t, e) => t + (e.scheduled_minutes ?? 0), presence)
    ).toBe(Math.round((endMs - startMs) / 60_000));
  });
});

describe('TimesheetCommandService.updateEntry — cancellation pay is not carer-editable', () => {
  it('refuses to edit a cancellation_paid fragment', async () => {
    // Since C7 the fragment's PAY is its stored `scheduled_minutes`, computed
    // once against the whole cancelled window. Letting the carer move its
    // clock times decouples the two silently — the row would read as three
    // hours and still bank four — and it corrupts the presence arithmetic the
    // next reconcile run does over the same window.
    const fragment = {
      ...submittedEntry,
      id: 't-cancel',
      kind: 'cancellation_paid',
      scheduled_minutes: 419,
    };
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({ getOwnedTimeEntry: mock(async () => fragment) }),
      makeUserService(),
      makePush()
    );

    await expect(
      svc.updateEntry('carer-1', 't-cancel', {
        clock_out_at: '2026-08-03T12:00:00.000Z',
      })
    ).rejects.toBeInstanceOf(TimeEntryNotEditableError);
    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });
});

describe('recordCancellationPaidEntry — a freed sliver is paid as a sliver (NEW-9)', () => {
  it('pays only what the gap has left when part of it is already banked', async () => {
    // Reachable end to end: reconcile pays 08:00-11:00 and 12:00-16:00 around
    // a worked 11:00-12:00; the carer then SHORTENS that worked entry to
    // 11:00-11:30 (legal — it touches, never overlaps); the nightly reconcile
    // re-runs and finds a freed [11:30, 12:00) sliver. Handing that sliver the
    // whole gap's share banks 270 minutes for 30 minutes of window — a stable,
    // permanently wrong paycheck.
    const at = (hhmm: string) => `2026-08-03T${hhmm}:00.000Z`;
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
      })),
      listOverlapCandidatesForCarer: mock(async () => [
        {
          ...submittedEntry,
          id: 't-worked',
          break_minutes: 0,
          scheduled_minutes: null,
          clock_in_at: at('11:00'),
          clock_out_at: at('11:30'), // shortened by the carer
        },
        {
          ...submittedEntry,
          id: 't-cancel-1',
          kind: 'cancellation_paid',
          break_minutes: 0,
          clock_in_at: at('08:00'),
          clock_out_at: at('11:00'),
          scheduled_minutes: 180,
        },
        {
          ...submittedEntry,
          id: 't-cancel-2',
          kind: 'cancellation_paid',
          break_minutes: 0,
          clock_in_at: at('12:00'),
          clock_out_at: at('16:00'),
          scheduled_minutes: 240,
        },
      ]),
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
      makeUserService(),
      makePush()
    );

    const created = await svc.recordCancellationPaidEntry({
      id: 's-cancel',
      household_id: 'h1',
      carer_id: 'carer-1',
      starts_at: at('08:00'),
      ends_at: at('16:00'),
      timezone: 'Europe/London',
      cancellation_paid: true,
    });

    expect(created.map(e => [e.clock_in_at, e.scheduled_minutes])).toEqual([
      [at('11:30'), 30],
    ]);
    // The whole window still adds up: 180 + 240 + 30 banked, 30 present.
    expect(180 + 240 + 30 + 30).toBe(480);
  });
});

describe('updateEntry — a worked entry cannot GROW into paid cancellation time', () => {
  it('refuses the edit rather than double-banking the overlap', async () => {
    // The mirror of the freed-sliver case. Shortening a worked entry frees
    // window (handled by the reconciler); LENGTHENING it into a fragment the
    // household has already paid for would bank the same minutes twice, and
    // nothing rewrites the existing fragment. The overlap guard already
    // refuses it — pinned here because the cancellation arithmetic relies on
    // it: a persisted fragment never overlaps presence.
    const at = (hhmm: string) => `2026-08-03T${hhmm}:00.000Z`;
    const worked = {
      ...submittedEntry,
      id: 't-worked',
      break_minutes: 0,
      clock_in_at: at('11:00'),
      clock_out_at: at('12:00'),
    };
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => [
        worked,
        {
          ...submittedEntry,
          id: 't-cancel-2',
          kind: 'cancellation_paid',
          break_minutes: 0,
          clock_in_at: at('12:00'),
          clock_out_at: at('16:00'),
          scheduled_minutes: 240,
        },
      ]),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries({ getOwnedTimeEntry: mock(async () => worked) }),
      makeUserService(),
      makePush()
    );

    await expect(
      svc.updateEntry('carer-1', 't-worked', { clock_out_at: at('13:00') })
    ).rejects.toBeInstanceOf(TimeEntryOverlapError);
    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });
});

describe('recordCancellationPaidEntry — a neighbouring window is not this window (NEW-10)', () => {
  // `listOverlapCandidatesForCarer` filters INCLUSIVELY at both ends, and 055
  // permits touching ranges, so the adjacent cancelled shift's fragment comes
  // back as a candidate. Counting it as "already banked" pays the second
  // window nothing at all.
  const at = (hhmm: string) => `2026-08-03T${hhmm}:00.000Z`;

  function svcWith(candidates: unknown[]) {
    const timeEntryRepo = makeTimeEntryRepo({
      listOverlapCandidatesForCarer: mock(async () => candidates),
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...submittedEntry,
        ...data,
      })),
    });
    return new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush()
    );
  }

  function fragment(id: string, from: string, to: string, minutes: number) {
    return {
      ...submittedEntry,
      id,
      kind: 'cancellation_paid',
      break_minutes: 0,
      clock_in_at: at(from),
      clock_out_at: at(to),
      scheduled_minutes: minutes,
    };
  }

  function window(id: string, from: string, to: string) {
    return {
      id,
      household_id: 'h1',
      carer_id: 'carer-1',
      starts_at: at(from),
      ends_at: at(to),
      timezone: 'Europe/London',
      cancellation_paid: true,
    };
  }

  it('pays the afternoon window in full when the morning one is already banked', async () => {
    const created = await svcWith([
      fragment('t-morning', '08:00', '16:00', 480),
    ]).recordCancellationPaidEntry(window('s-afternoon', '16:00', '20:00'));

    expect(created.map(e => e.scheduled_minutes)).toEqual([240]);
  });

  it('pays the morning window in full when the afternoon one is already banked', async () => {
    const created = await svcWith([
      fragment('t-afternoon', '16:00', '20:00', 240),
    ]).recordCancellationPaidEntry(window('s-morning', '08:00', '16:00'));

    expect(created.map(e => e.scheduled_minutes)).toEqual([480]);
  });

  it('ignores an earlier neighbour that ends where this window starts', async () => {
    const created = await svcWith([
      fragment('t-earlier', '06:00', '08:00', 120),
    ]).recordCancellationPaidEntry(window('s-morning', '08:00', '16:00'));

    expect(created.map(e => e.scheduled_minutes)).toEqual([480]);
  });
});

describe('TimesheetCommandService.voidEntry', () => {
  function makeVoidableSvc(
    overrides: {
      timeEntryRepo?: any;
      timesheetRepo?: any;
      entry?: Record<string, unknown>;
      queries?: any;
    } = {}
  ) {
    return new TimesheetCommandService(
      overrides.timeEntryRepo ?? makeTimeEntryRepo(),
      overrides.timesheetRepo ??
        makeTimesheetRepo({
          findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
        }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      overrides.queries ??
        makeQueries({
          getOwnedTimeEntry: mock(
            async () => overrides.entry ?? submittedEntry
          ),
        }),
      makeUserService(),
      makePush()
    );
  }

  it('voids a running entry — accidental clock-in is the primary case', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...runningEntry,
        ...patch,
      })),
    });
    const svc = makeVoidableSvc({
      timeEntryRepo,
      entry: runningEntry,
    });

    const result = await svc.voidEntry('carer-1', 't1');

    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: 'voided' })
    );
    expect(result.status).toBe('voided');
  });

  it('voids a submitted entry while its week is still unapproved', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [
        { ...finishedEntryA, id: 't1', status: 'voided' },
      ]),
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...submittedEntry,
        ...patch,
      })),
    });
    const svc = makeVoidableSvc({ timeEntryRepo });

    const result = await svc.voidEntry('carer-1', 't1');

    expect(result.status).toBe('voided');
    expect(timeEntryRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: 'voided' })
    );
  });

  it('refuses to void an entry in a week the parent has already approved', async () => {
    const svc = makeVoidableSvc({
      timesheetRepo: makeTimesheetRepo({
        findByWeek: mock(async () => ({ ...timesheet, status: 'approved' })),
      }),
    });

    await expect(svc.voidEntry('carer-1', 't1')).rejects.toBeInstanceOf(
      TimeEntryNotEditableError
    );
    await expect(svc.voidEntry('carer-1', 't1')).rejects.toMatchObject({
      metadata: { editableReason: 'week_approved' },
    });
  });

  it('refuses to void cancellation pay — the shift is the source of truth', async () => {
    const cancelPaidEntry = {
      ...submittedEntry,
      id: 't-cancel',
      kind: 'cancellation_paid',
    };
    const svc = makeVoidableSvc({ entry: cancelPaidEntry });

    await expect(svc.voidEntry('carer-1', 't-cancel')).rejects.toBeInstanceOf(
      TimeEntryNotEditableError
    );
    await expect(svc.voidEntry('carer-1', 't-cancel')).rejects.toMatchObject({
      metadata: { editableReason: 'cancellation_paid' },
    });
  });

  it("throws TimeEntryNotFoundError for another carer's entry — no existence leak", async () => {
    const svc = makeVoidableSvc({
      queries: makeQueries({
        getOwnedTimeEntry: mock(async () => {
          throw new TimeEntryNotFoundError('t-other');
        }),
      }),
    });

    await expect(svc.voidEntry('carer-1', 't-other')).rejects.toBeInstanceOf(
      TimeEntryNotFoundError
    );
  });

  it('is idempotent — a second void returns the row and rolls up only once', async () => {
    const voided = { ...submittedEntry, status: 'voided' };
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [
        { ...finishedEntryA, status: 'voided' },
      ]),
      update: mock(async (_id: string, patch: Record<string, unknown>) => {
        if (patch.status === 'voided') {
          return { ...submittedEntry, ...patch };
        }
        return voided;
      }),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });
    const svc = makeVoidableSvc({ timeEntryRepo, timesheetRepo });

    const first = await svc.voidEntry('carer-1', 't1');
    const second = await svc.voidEntry('carer-1', 't1');

    expect(first.status).toBe('voided');
    expect(second.status).toBe('voided');
    expect(timesheetRepo.update).toHaveBeenCalledTimes(1);
  });

  it('keeps a voided entry voided when a later updateEntry roll-up runs (resurrection site — rollUpIntoTimesheet create at :1882)', async () => {
    const voidedEntry = {
      ...submittedEntry,
      id: 't-voided',
      status: 'voided',
    };
    const otherEntry = {
      ...submittedEntry,
      id: 't-other',
      clock_in_at: '2026-08-04T08:00:00.000Z',
      clock_out_at: '2026-08-04T13:00:00.000Z',
      local_date: '2026-08-04',
      break_minutes: 0,
    };
    const weekStore = [voidedEntry, otherEntry];
    const update = mock(async (id: string, patch: Record<string, unknown>) => {
      const idx = weekStore.findIndex(e => e.id === id);
      if (idx === -1) {
        throw new Error(`unexpected update ${id}`);
      }
      // `patch` is Record<string, unknown>, so the spread widens every
      // field to optional; the cast keeps the store's element type.
      weekStore[idx] = {
        ...weekStore[idx],
        ...patch,
      } as (typeof weekStore)[number];
      return weekStore[idx];
    });
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => weekStore),
      listOverlapCandidatesForCarer: mock(async () => weekStore),
      update,
    });
    const queries = makeQueries({
      getOwnedTimeEntry: mock(async (_userId: string, id: string) => {
        const row = weekStore.find(e => e.id === id);
        if (!row) {
          throw new TimeEntryNotFoundError(id);
        }
        return row;
      }),
    });
    const svc = makeVoidableSvc({
      timeEntryRepo,
      queries,
      timesheetRepo: makeTimesheetRepo({
        findByWeek: mock(async () => null),
      }),
    });

    await svc.voidEntry('carer-1', 't-voided');
    await svc.updateEntry('carer-1', 't-other', { break_minutes: 15 });

    expect(weekStore.find(e => e.id === 't-voided')?.status).toBe('voided');
    const voidedUpdates = update.mock.calls.filter(
      ([id, patch]) => id === 't-voided' && patch.status === 'submitted'
    );
    expect(voidedUpdates).toHaveLength(0);
  });

  it('keeps a voided entry voided when a later cross-week clockOut roll-up runs (resurrection site — clockOutAcrossWeeks patch at :706)', async () => {
    const voidedEntry = {
      ...submittedEntry,
      id: 't-voided',
      status: 'voided',
      clock_in_at: '2026-01-11T20:00:00.000Z',
      clock_out_at: '2026-01-11T22:00:00.000Z',
      local_date: '2026-01-11',
      timezone: 'Europe/London',
    };
    const runningOther = {
      ...runningEntry,
      id: 't-running',
      shift_id: null,
      clock_in_at: '2026-01-11T23:00:00.000Z', // Sun 23:00 London
      local_date: '2026-01-11',
      timezone: 'Europe/London',
      break_minutes: 0,
    };
    const weekStore = [voidedEntry, runningOther];
    const update = mock(async (id: string, patch: Record<string, unknown>) => {
      const idx = weekStore.findIndex(e => e.id === id);
      if (idx === -1) {
        throw new Error(`unexpected update ${id}`);
      }
      // `patch` is Record<string, unknown>, so the spread widens every
      // field to optional; the cast keeps the store's element type.
      weekStore[idx] = {
        ...weekStore[idx],
        ...patch,
      } as (typeof weekStore)[number];
      return weekStore[idx];
    });
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () =>
        weekStore.filter(e => e.clock_out_at != null)
      ),
      listOverlapCandidatesForCarer: mock(async () => weekStore),
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...runningOther,
        ...data,
        id: 't-fragment-b',
        local_date: localDateOf(
          new Date(data.clock_in_at as string),
          data.timezone as string
        ),
      })),
      update,
    });
    const queries = makeQueries({
      getOwnedTimeEntry: mock(async (_userId: string, id: string) => {
        const row = weekStore.find(e => e.id === id);
        if (!row) {
          throw new TimeEntryNotFoundError(id);
        }
        return row;
      }),
    });
    const svc = makeVoidableSvc({
      timeEntryRepo,
      queries,
      timesheetRepo: makeTimesheetRepo({
        findByWeek: mock(async () => null),
      }),
    });

    await svc.voidEntry('carer-1', 't-voided');
    await svc.clockOut('carer-1', 't-running', {
      clock_out_at: '2026-01-12T02:00:00.000Z',
    });

    expect(weekStore.find(e => e.id === 't-voided')?.status).toBe('voided');
    const voidedResurrections = update.mock.calls.filter(
      ([id, patch]) => id === 't-voided' && patch.status === 'submitted'
    );
    expect(voidedResurrections).toHaveLength(0);
  });
});

/**
 * 069 MONEY INVARIANTS — written by the orchestrator, not by the agent that
 * implemented the filters, because an implementer verifying its own filter
 * is exactly how an unfiltered read survives a green suite.
 *
 * Each asserts a CONSEQUENCE in money terms rather than the mechanism: what
 * the household is billed and what the carer is owed once an entry is voided.
 */
describe('069 money invariants — a voided entry did not happen', () => {
  const paidShift = {
    id: 's-void-money',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: '2026-08-03T09:00:00.000Z',
    ends_at: '2026-08-03T17:00:00.000Z', // 480 min cancelled window
    timezone: 'Europe/London',
    cancellation_paid: true,
  };

  function makeSvc(timeEntryRepo: any, timesheetRepo: any) {
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

  it('pays the FULL cancelled window when the only overlapping worked entry was voided — the underpay trap', async () => {
    // She clocked into half this cancelled shift, then voided that entry: it
    // did not happen, so she stood down for the WHOLE window and is owed all
    // 480 minutes. If a voided row reached `remainingSpans` it would close
    // the 09:00-13:00 gap and she would silently be paid 240 — the carer
    // loses money and nothing anywhere reports an error.
    const created: any[] = [];
    const timeEntryRepo = makeTimeEntryRepo({
      // What the repository returns NOW that it filters voided rows.
      listOverlapCandidatesForCarer: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) => {
        const row = { ...submittedEntry, ...data, id: `t-${created.length}` };
        created.push(row);
        return row;
      }),
      listForCarerWeek: mock(async () => []),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });

    await makeSvc(timeEntryRepo, timesheetRepo).recordCancellationPaidEntry(
      paidShift
    );

    expect(created).toHaveLength(1);
    expect(created[0].scheduled_minutes).toBe(480);
    expect(created[0].clock_in_at).toBe(paidShift.starts_at);
    expect(created[0].clock_out_at).toBe(paidShift.ends_at);
  });

  it('banks a week total that ignores the voided entry entirely', async () => {
    // The figure the parent is asked to approve. `finishedEntryA` is 450
    // payable minutes; the voided row would add 300 more if it counted.
    const voided = {
      ...submittedEntry,
      id: 't-voided',
      clock_in_at: '2026-08-04T08:00:00.000Z',
      clock_out_at: '2026-08-04T13:00:00.000Z', // 300 min if it counted
      break_minutes: 0,
      scheduled_minutes: null,
      status: 'voided',
    };
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [
        { ...submittedEntry, ...finishedEntryA },
        voided,
      ]),
      // The voided row must come back FINISHED — `rollUpIntoTimesheet` bails
      // on a row with no clock_out_at, and then nothing is banked at all.
      update: mock(async (_id: string, patch: Record<string, unknown>) => ({
        ...submittedEntry,
        id: 't-other',
        ...patch,
      })),
    });
    const timesheetRepo = makeTimesheetRepo({
      findByWeek: mock(async () => ({ ...timesheet, status: 'submitted' })),
    });
    const queries = makeQueries({
      getOwnedTimeEntry: mock(async () => ({
        ...submittedEntry,
        id: 't-other',
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      queries,
      makeUserService(),
      makePush()
    );

    await svc.voidEntry('carer-1', 't-other');

    expect(timesheetRepo.update).toHaveBeenCalledWith(
      'ts1',
      expect.objectContaining({ total_minutes: 450 })
    );
  });
});

// =============================================================================
// Approve with the parent's final adjustment (Option A: a parameter of the
// approval, folded atomically into the frozen snapshot — no migration, no new
// endpoint, no persisted pre-approval state).
//
// The invariant every test below is really guarding: the COLUMN gross and the
// JSONB gross are written from one binding and can never disagree, because
// payments Gate 4, the CSV export and every frozen read take that agreement
// for granted and were changed nowhere to accommodate this feature.
// =============================================================================

describe('TimesheetCommandService.approve — the parent adjustment', () => {
  const MAX_GROSS_MINOR = 99_999_999;

  function approvingSvc(timesheetRepo: any, earnings: any = makeEarnings()) {
    return new TimesheetCommandService(
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
  }

  /** The engine's ok arm, priced at whatever gross a case needs. */
  function earningsGrossing(grossMinor: number): any {
    const okWeek = computedEarnings as Extract<WeekEarnings, { status: 'ok' }>;
    return makeEarnings({
      computeForWeek: mock(async () => ({
        ...okWeek,
        gross_minor: grossMinor,
      })),
    });
  }

  function patchOf(timesheetRepo: any): Record<string, unknown> {
    const [, patch] = timesheetRepo.approveSubmittedWithEarnings.mock
      .calls[0] as [string, Record<string, unknown>];
    return patch;
  }

  it('adds a bonus to the gross, in BOTH the column and the jsonb', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo);

    await svc.approve('parent-1', 'ts1', {
      adjustment: { amount_minor: 2_500, note: 'Late pickup on Thursday' },
    });

    const patch = patchOf(timesheetRepo);
    expect(patch.gross_minor).toBe(17_300);
    expect(patch.earnings).toEqual({
      ...computedEarnings,
      gross_minor: 17_300,
      adjustment: {
        amount_minor: 2_500,
        note: 'Late pickup on Thursday',
        created_by: 'parent-1',
        created_at: patch.approved_at as string,
      },
      v: 1,
    });
    const frozen = patch.earnings as Extract<WeekEarnings, { status: 'ok' }>;
    expect(frozen.gross_minor).toBe(17_300);
    expect(frozen.adjustment).toEqual({
      amount_minor: 2_500,
      note: 'Late pickup on Thursday',
      created_by: 'parent-1',
      created_at: patch.approved_at as string,
    });
  });

  it('takes a deduction off the gross, in BOTH the column and the jsonb', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo);

    await svc.approve('parent-1', 'ts1', {
      adjustment: { amount_minor: -2_000, note: 'Advance repaid' },
    });

    const patch = patchOf(timesheetRepo);
    expect(patch.gross_minor).toBe(12_800);
    const frozen = patch.earnings as Extract<WeekEarnings, { status: 'ok' }>;
    expect(frozen.gross_minor).toBe(12_800);
    expect(frozen.adjustment?.amount_minor).toBe(-2_000);
  });

  it('leaves the line items completely alone — the adjustment is a sibling, not a line', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo);

    await svc.approve('parent-1', 'ts1', {
      adjustment: { amount_minor: -2_000, note: 'Advance repaid' },
    });

    const frozen = patchOf(timesheetRepo).earnings as Extract<
      WeekEarnings,
      { status: 'ok' }
    >;
    const computed = computedEarnings as Extract<
      WeekEarnings,
      { status: 'ok' }
    >;
    expect(frozen.lines).toEqual(computed.lines);
    expect(frozen.reimbursements_minor).toBe(computed.reimbursements_minor);
    expect(frozen.worked_minutes).toBe(computed.worked_minutes);
  });

  it('stamps created_at with the SAME instant as the approval', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo);

    await svc.approve('parent-1', 'ts1', {
      adjustment: { amount_minor: 500, note: 'Bonus' },
    });

    const patch = patchOf(timesheetRepo);
    const frozen = patch.earnings as Extract<WeekEarnings, { status: 'ok' }>;
    expect(frozen.adjustment?.created_at).toBe(patch.approved_at as string);
    expect(frozen.adjustment?.created_at).toBe(
      patch.earnings_computed_at as string
    );
  });

  it('trims the note before freezing it — a permanent record the carer reads', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo);

    await svc.approve('parent-1', 'ts1', {
      adjustment: { amount_minor: 500, note: '  Bus fares  ' },
    });

    const frozen = patchOf(timesheetRepo).earnings as Extract<
      WeekEarnings,
      { status: 'ok' }
    >;
    expect(frozen.adjustment?.note).toBe('Bus fares');
  });

  it('writes NO adjustment key at all when none was supplied', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo);

    await svc.approve('parent-1', 'ts1');

    const patch = patchOf(timesheetRepo);
    expect(patch.gross_minor).toBe(14_800);
    expect(patch.earnings).toEqual({ ...computedEarnings, v: 1 });
    expect(patch.earnings).not.toHaveProperty('adjustment');
  });

  it('treats an explicitly null adjustment as no adjustment', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo);

    await svc.approve('parent-1', 'ts1', { adjustment: null });

    expect(patchOf(timesheetRepo).earnings).toEqual({
      ...computedEarnings,
      v: 1,
    });
  });

  it('allows a deduction that lands the week on exactly zero', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo);

    await svc.approve('parent-1', 'ts1', {
      adjustment: { amount_minor: -14_800, note: 'Paid in advance last week' },
    });

    const patch = patchOf(timesheetRepo);
    expect(patch.gross_minor).toBe(0);
    const frozen = patch.earnings as Extract<WeekEarnings, { status: 'ok' }>;
    expect(frozen.gross_minor).toBe(0);
  });

  it('REFUSES a deduction that would push the week negative, and writes nothing', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo);

    await expect(
      svc.approve('parent-1', 'ts1', {
        adjustment: { amount_minor: -14_801, note: 'Too much' },
      })
    ).rejects.toBeInstanceOf(TimesheetAdjustmentNegativeGrossError);
    expect(timesheetRepo.approveSubmittedWithEarnings).not.toHaveBeenCalled();
  });

  it('names the ceiling it hit rather than clamping to zero', async () => {
    const svc = approvingSvc(makeApprovingRepo());

    const err = (await svc
      .approve('parent-1', 'ts1', {
        adjustment: { amount_minor: -20_000, note: 'Too much' },
      })
      .catch((e: unknown) => e)) as {
      statusCode?: number;
      metadata?: { grossMinor?: number; adjustmentMinor?: number };
    };

    expect(err.statusCode).toBe(400);
    expect(err.metadata?.grossMinor).toBe(14_800);
    expect(err.metadata?.adjustmentMinor).toBe(-20_000);
  });

  it('BOUNDARY: an adjusted total landing exactly ON the cap approves', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(
      timesheetRepo,
      earningsGrossing(MAX_GROSS_MINOR - 1)
    );

    await svc.approve('parent-1', 'ts1', {
      adjustment: { amount_minor: 1, note: 'One penny' },
    });

    expect(patchOf(timesheetRepo).gross_minor).toBe(MAX_GROSS_MINOR);
  });

  it('BOUNDARY: one penny past the cap is refused, never clamped', async () => {
    const timesheetRepo = makeApprovingRepo();
    const svc = approvingSvc(timesheetRepo, earningsGrossing(MAX_GROSS_MINOR));

    await expect(
      svc.approve('parent-1', 'ts1', {
        adjustment: { amount_minor: 1, note: 'One penny too many' },
      })
    ).rejects.toBeInstanceOf(TimesheetGrossTooLargeError);
    expect(timesheetRepo.approveSubmittedWithEarnings).not.toHaveBeenCalled();
  });

  it('attributes an oversized COMPUTED gross to the rate, even when a deduction would rescue it', async () => {
    // Order matters: the computed-gross guard runs BEFORE the fold, so a
    // broken arrangement is reported as a broken arrangement instead of being
    // masked by the parent's deduction.
    const svc = approvingSvc(
      makeApprovingRepo(),
      earningsGrossing(3_999_999_960)
    );

    const err = (await svc
      .approve('parent-1', 'ts1', {
        adjustment: { amount_minor: -MAX_GROSS_MINOR, note: 'Rescue attempt' },
      })
      .catch((e: unknown) => e)) as {
      metadata?: { grossMinor?: number };
    };

    expect(err).toBeInstanceOf(TimesheetGrossTooLargeError);
    expect(err.metadata?.grossMinor).toBe(3_999_999_960);
  });

  it('REFUSES an adjustment on a no_arrangement week — no base, no number', async () => {
    const timesheetRepo = makeApprovingRepo();
    const noArrangement: WeekEarnings = {
      status: 'no_arrangement',
      week_start: '2026-08-03',
      unpriced_dates: ['2026-08-03'],
    };
    const svc = approvingSvc(
      timesheetRepo,
      makeEarnings({ computeForWeek: mock(async () => noArrangement) })
    );

    const err = (await svc
      .approve('parent-1', 'ts1', {
        adjustment: { amount_minor: 1_500, note: 'Bonus' },
      })
      .catch((e: unknown) => e)) as {
      statusCode?: number;
      metadata?: { reason?: string };
    };

    expect(err).toBeInstanceOf(TimesheetAdjustmentNotAllowedError);
    expect(err.statusCode).toBe(409);
    expect(err.metadata?.reason).toBe('no_arrangement');
    expect(timesheetRepo.approveSubmittedWithEarnings).not.toHaveBeenCalled();
  });

  it('leaves the no_arrangement week EXACTLY as it was when no adjustment is supplied', async () => {
    const timesheetRepo = makeApprovingRepo();
    const noArrangement: WeekEarnings = {
      status: 'no_arrangement',
      week_start: '2026-08-03',
      unpriced_dates: ['2026-08-03'],
    };
    const svc = approvingSvc(
      timesheetRepo,
      makeEarnings({ computeForWeek: mock(async () => noArrangement) })
    );

    await svc.approve('parent-1', 'ts1');

    const patch = patchOf(timesheetRepo);
    expect(patch.gross_minor).toBeNull();
    expect(patch.currency).toBeNull();
    expect(patch.earnings).toEqual({ ...noArrangement, v: 1 });
  });

  it('REFUSES an adjustment on a currency_change week', async () => {
    const timesheetRepo = makeApprovingRepo();
    const currencyChange: WeekEarnings = {
      status: 'currency_change',
      week_start: '2026-08-03',
      currencies: ['GBP', 'EUR'],
    };
    const svc = approvingSvc(
      timesheetRepo,
      makeEarnings({ computeForWeek: mock(async () => currencyChange) })
    );

    const err = (await svc
      .approve('parent-1', 'ts1', {
        adjustment: { amount_minor: 1_500, note: 'Bonus' },
      })
      .catch((e: unknown) => e)) as { metadata?: { reason?: string } };

    expect(err).toBeInstanceOf(TimesheetAdjustmentNotAllowedError);
    expect(err.metadata?.reason).toBe('currency_change');
    expect(timesheetRepo.approveSubmittedWithEarnings).not.toHaveBeenCalled();
  });

  it('REFUSES an adjustment on a departed-carer week, and never asks the engine', async () => {
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

    const err = (await svc
      .approve('parent-1', 'ts1', {
        adjustment: { amount_minor: 1_500, note: 'Bonus' },
      })
      .catch((e: unknown) => e)) as { metadata?: { reason?: string } };

    expect(err).toBeInstanceOf(TimesheetAdjustmentNotAllowedError);
    expect(err.metadata?.reason).toBe('carer_removed');
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
    expect(timesheetRepo.approveSubmittedWithEarnings).not.toHaveBeenCalled();
  });

  it('still approves a departed-carer week with an empty snapshot when no adjustment is supplied', async () => {
    const timesheetRepo = makeApprovingRepo();
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
      makeEarnings()
    );

    await svc.approve('parent-1', 'ts1');

    expect(patchOf(timesheetRepo).gross_minor).toBeNull();
  });

  it('drops the adjustment with the rest of the approval when the CAS loses the race', async () => {
    const timesheetRepo = makeApprovingRepo({
      approveSubmittedWithEarnings: mock(async () => null),
    });
    const svc = approvingSvc(timesheetRepo);

    await expect(
      svc.approve('parent-1', 'ts1', {
        adjustment: { amount_minor: -2_000, note: 'Advance repaid' },
      })
    ).rejects.toBeInstanceOf(TimesheetNotActionableError);
  });

  it('is refused for a carer before any of this is reached', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeApprovingRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      makePush(),
      makeEarnings()
    );

    await expect(
      svc.approve('carer-1', 'ts1', {
        adjustment: { amount_minor: 1_000, note: 'Self-awarded bonus' },
      })
    ).rejects.toBeInstanceOf(NotATimesheetParentError);
  });

  it('forks ONLY the push body — same type, same title, same payload', async () => {
    const push = makePush();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeApprovingRepo(),
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      push,
      makeEarnings()
    );

    await svc.approve('parent-1', 'ts1', {
      adjustment: { amount_minor: -2_000, note: 'Advance repaid' },
    });

    const [, payload] = push.notifyUser.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.title).toBe('Hours approved');
    expect(payload.body).toBe(
      'A parent approved your hours this week, with an adjustment included.'
    );
    // No figure on a lock screen — it could carry no state label.
    expect(payload.body).not.toContain('20');
    expect(payload.data).toMatchObject({
      type: PUSH_NOTIFICATION_TYPES.TIMESHEET_APPROVED,
      timesheetId: 'ts1',
    });
  });

  it('keeps the original push body when there is no adjustment', async () => {
    const push = makePush();
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeApprovingRepo(),
      makeParentMemberRepo(),
      makeHouseholdRepo(),
      makeShiftRepo(),
      makeQueries(),
      makeUserService(),
      push,
      makeEarnings()
    );

    await svc.approve('parent-1', 'ts1');

    const [, payload] = push.notifyUser.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.body).toBe('A parent approved your hours this week.');
  });
});

// =============================================================================
// Per-household workweek start (§5 D-8, migration 075)
// =============================================================================
//
// `households.week_starts_on` is an employer-designated FIXED recurring 7-day
// workweek (FLSA), chosen at setup and immutable once a timesheet exists. The
// US default is Sunday. Everything below is the SAME household, the SAME
// zone, and the SAME hours as the Monday-start tests above — only
// `week_starts_on` differs, so any assertion that changes is changing because
// of the workweek and nothing else.
//
// Unlike `timezone`, this is NOT anchored to the entry's own frozen column:
// there is no per-row copy, and there does not need to be. The value cannot
// move once a timesheet exists, so the household's current value is the same
// value every existing row was bucketed under — the drift F-B1-4 guards
// against for `timezone` is structurally impossible here.
const sundayStartHousehold = {
  id: 'h1',
  timezone: 'Europe/London',
  week_starts_on: 0,
};

describe('workweek start: the clock-out roll-up buckets by the HOUSEHOLD week (§5 D-8)', () => {
  it('files a Monday clock-out into the preceding SUNDAY for a Sunday-start household', async () => {
    // Identical to the Monday-start roll-up test above in every respect
    // except `week_starts_on`. 2026-08-03 is a Monday; a Sunday-start
    // household's week began 2026-08-02, so pricing these hours into
    // '2026-08-03' would open a second, phantom week and split the week's
    // overtime across two timesheets.
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo({ findById: mock(async () => sundayStartHousehold) }),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      break_minutes: 30,
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        carer_id: 'carer-1',
        week_start: '2026-08-02', // Sunday, NOT the Monday 2026-08-03
        total_minutes: 450,
        status: 'submitted',
      })
    );
  });

  it('reads the week`s entries over the household`s OWN seven days, not a Monday..Sunday span', async () => {
    // The roll-up derives `total_minutes` from `listForCarerWeek`, so the
    // bucket and the range it sums must come from one source. A Sunday-start
    // household must be asked for [Sun 02, Sun 09), not [Mon 03, Mon 10) —
    // otherwise the Sunday's hours are summed into no week at all.
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo({ findById: mock(async () => sundayStartHousehold) }),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      break_minutes: 30,
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timeEntryRepo.listForCarerWeek).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-02',
      '2026-08-09'
    );
  });

  it('still files a Monday clock-out into that Monday for a Monday-start household', async () => {
    // The mirror image, so a regression that hardcodes SUNDAY instead of
    // Monday cannot pass this suite either.
    const timeEntryRepo = makeTimeEntryRepo({
      listForCarerWeek: mock(async () => [finishedEntryA]),
    });
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo({
        findById: mock(async () => ({ ...household, week_starts_on: 1 })),
      }),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      break_minutes: 30,
      clock_out_at: '2026-08-03T16:00:00.000Z',
    });

    expect(timesheetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ week_start: '2026-08-03' })
    );
  });
});

describe('workweek start: the overnight session splitter turns over on the household`s own night', () => {
  // A session that runs across the week turnover is TWO weeks' work and
  // becomes two rows (C6). WHICH night that is, is `week_starts_on`: a
  // Sunday-start household turns over on Saturday night, a Monday-start one
  // on Sunday night. Get it wrong and a whole night shift is priced into the
  // wrong week — against the wrong overtime threshold, at the wrong week's
  // rate.
  const saturdayNightEntry = {
    ...runningEntry,
    clock_in_at: '2026-08-08T21:00:00.000Z', // Sat 22:00 BST
    local_date: '2026-08-08',
  };

  /**
   * Models 017's `local_date` TRIGGER: the column is derived from
   * `clock_in_at` in the row's own zone, never sent by the client. The
   * roll-up buckets off `local_date`, so a mock that let a fragment keep the
   * fixture's stale date would test nothing about which week each half lands
   * in — the very thing these two tests exist to check.
   */
  function withDerivedLocalDate(data: Record<string, unknown>) {
    const clockInAt = String(data.clock_in_at ?? runningEntry.clock_in_at);
    return {
      ...runningEntry,
      ...data,
      local_date: localDateOf(new Date(clockInAt), 'Europe/London'),
    };
  }

  function makeSplitAwareRepo() {
    return makeTimeEntryRepo({
      listForCarerWeek: mock(async () => []),
      createSubmitted: mock(async (data: Record<string, unknown>) =>
        withDerivedLocalDate(data)
      ),
      update: mock(async (_id: string, patch: Record<string, unknown>) =>
        withDerivedLocalDate({
          ...saturdayNightEntry,
          ...patch,
        })
      ),
    });
  }

  it('SPLITS a Saturday-night session for a Sunday-start household', async () => {
    const timeEntryRepo = makeSplitAwareRepo();
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo({ findById: mock(async () => sundayStartHousehold) }),
      makeShiftRepo(),
      makeQueries({ getOwnedTimeEntry: mock(async () => saturdayNightEntry) }),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-09T05:00:00.000Z', // Sun 06:00 BST
    });

    // Two weeks touched: the outgoing week (starting Sun 2026-08-02) and the
    // incoming one (starting Sun 2026-08-09).
    const weeks = timesheetRepo.create.mock.calls.map(
      (call: unknown[]) => (call[0] as { week_start: string }).week_start
    );
    expect(new Set(weeks)).toEqual(new Set(['2026-08-02', '2026-08-09']));
  });

  it('does NOT split the same Saturday-night session for a Monday-start household', async () => {
    // Sat 22:00 -> Sun 06:00 is entirely inside a Monday-start week, so this
    // is ONE row. Splitting it would invent a week boundary that household
    // never agreed to.
    const timeEntryRepo = makeSplitAwareRepo();
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo({
        findById: mock(async () => ({ ...household, week_starts_on: 1 })),
      }),
      makeShiftRepo(),
      makeQueries({ getOwnedTimeEntry: mock(async () => saturdayNightEntry) }),
      makeUserService()
    );

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-09T05:00:00.000Z',
    });

    const weeks = timesheetRepo.create.mock.calls.map(
      (call: unknown[]) => (call[0] as { week_start: string }).week_start
    );
    expect(new Set(weeks)).toEqual(new Set(['2026-08-03']));
  });
});

describe('workweek start: the retroactive-entry week-crossing guard', () => {
  it('REFUSES a Saturday-night window that crosses a Sunday-start household`s turnover', async () => {
    const svc = new TimesheetCommandService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo({ findById: mock(async () => sundayStartHousehold) }),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await expect(
      svc.createRetroactiveEntry('carer-1', {
        household_id: 'h1',
        clock_in_at: '2026-08-08T21:00:00.000Z', // Sat
        clock_out_at: '2026-08-09T05:00:00.000Z', // Sun — a new week here
      })
    ).rejects.toBeInstanceOf(InvalidClockTimesError);
  });

  it('ACCEPTS the same window for a Monday-start household, where it crosses nothing', async () => {
    const timeEntryRepo = makeTimeEntryRepo({
      createSubmitted: mock(async (data: Record<string, unknown>) => ({
        ...runningEntry,
        ...data,
      })),
    });
    const svc = new TimesheetCommandService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo({
        findById: mock(async () => ({ ...household, week_starts_on: 1 })),
      }),
      makeShiftRepo(),
      makeQueries(),
      makeUserService()
    );

    await svc.createRetroactiveEntry('carer-1', {
      household_id: 'h1',
      clock_in_at: '2026-08-08T21:00:00.000Z',
      clock_out_at: '2026-08-09T05:00:00.000Z',
    });

    expect(timeEntryRepo.createSubmitted).toHaveBeenCalled();
  });
});

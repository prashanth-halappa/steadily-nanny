/**
 * @module tests/unit/domains/timesheet/services/timesheetCommandService.removedMember
 *
 * The ONE write a removed member keeps: clock-out.
 *
 * Every other id-scoped write resolves an ACTIVE membership through
 * `getOwnedTimeEntry` (F-B3b-3), and that is right — a person who no longer
 * belongs to a household must not create or correct hours it pays against.
 * But a `running` row she started while she still did belong is a record she
 * is COMPLETING, not an obligation she is creating. Refuse it and her shift
 * runs forever, she loses the hours, and
 * `time_entries_one_running_per_carer` then blocks every future clock-in
 * anywhere — the F-B2-4 stranded-entry class, reached by a different door.
 *
 * The door that matters now: the parent deletes their account and the
 * household loses its last writer, so `UserService` flips her membership to
 * `removed` while she is on shift. Nobody removed her; the app did.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

const CLOCK_IN_UTC = '2026-08-14T21:00:00.000Z';
const CLOCK_OUT_UTC = '2026-08-15T01:00:00.000Z';
const TZ = 'Pacific/Auckland';

const household = { id: 'h1', timezone: TZ, week_starts_on: 1 };

const runningEntry = {
  id: 't1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  shift_id: null,
  clock_in_at: CLOCK_IN_UTC,
  clock_out_at: null,
  break_minutes: 0,
  scheduled_minutes: null,
  kind: 'worked',
  note: null,
  status: 'running',
  local_date: '2026-08-15',
  timezone: TZ,
  created_at: 't',
  updated_at: 't',
};

let TimesheetCommandService: typeof import('../../../../../src/domains/timesheet/services/timesheetCommandService').TimesheetCommandService;
let TimeEntryNotFoundError: typeof import('../../../../../src/domains/timesheet/errors/timesheetErrors').TimeEntryNotFoundError;
let NotACarerError: typeof import('../../../../../src/domains/timesheet/errors/timesheetErrors').NotACarerError;

beforeAll(async () => {
  mock.module(
    '../../../../../src/domains/pay/services/termsGateService',
    () => ({
      termsGateService: { assertAgreed: mock(async () => undefined) },
      TermsGateService: class {},
    })
  );

  TimesheetCommandService = (
    await import(
      '../../../../../src/domains/timesheet/services/timesheetCommandService'
    )
  ).TimesheetCommandService;
  const errors = await import(
    '../../../../../src/domains/timesheet/errors/timesheetErrors'
  );
  TimeEntryNotFoundError = errors.TimeEntryNotFoundError;
  NotACarerError = errors.NotACarerError;
});

type Any = any;

/**
 * A service whose household knows this carer only as a `removed` row — the
 * state `UserService`'s household closure leaves her in.
 */
function makeServiceForRemovedMember(entry: Record<string, unknown>) {
  const timeEntryRepo: Any = {
    findById: mock(async () => entry),
    findRunningForCarer: mock(async () => null),
    clockIn: mock(async () => entry),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      ...entry,
      ...patch,
    })),
    listForCarerWeek: mock(async () => []),
    listOverlapCandidatesForCarer: mock(async () => []),
  };
  const timesheetRepo: Any = {
    findByWeek: mock(async () => null),
    create: mock(async (data: Record<string, unknown>) => ({
      id: 'ts1',
      status: 'submitted',
      ...data,
    })),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      id: 'ts1',
      status: 'submitted',
      ...patch,
    })),
  };
  const memberRepo: Any = {
    // She is gone: the active lookup every other write gate uses finds nothing.
    findActiveMembership: mock(async () => null),
    findMembershipAnyStatus: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'carer-1',
      role: 'nanny',
      status: 'removed',
    })),
  };
  const householdRepo: Any = { findById: mock(async () => household) };
  const shiftRepo: Any = {
    findById: mock(async () => null),
    findByHouseholdAndRange: mock(async () => []),
  };
  const queries: Any = {
    // The strict gate, unchanged, refusing her exactly as it does today.
    getOwnedTimeEntry: mock(async (_userId: string, id: string) => {
      throw new TimeEntryNotFoundError(id);
    }),
    getOwnedTimesheet: mock(async () => null),
  };
  const userService: Any = {
    getProfileById: mock(async () => ({ user_id: 'carer-1', name: 'Nia' })),
  };
  const push: Any = {
    notifyUser: mock(() => undefined),
    notifyHouseholdParents: mock(() => undefined),
  };
  const earnings: Any = { computeWeek: mock(async () => null) };
  const eventRepo: Any = { insertMany: mock(async () => []) };

  const svc = new TimesheetCommandService(
    timeEntryRepo,
    timesheetRepo,
    memberRepo,
    householdRepo,
    shiftRepo,
    queries,
    userService,
    push,
    earnings,
    eventRepo
  );
  return { svc, timeEntryRepo, memberRepo, queries };
}

describe('clockOut — still open to a member who was removed mid-shift', () => {
  it('closes the entry she started while she was still active', async () => {
    const { svc, timeEntryRepo } = makeServiceForRemovedMember(runningEntry);

    const updated = await svc.clockOut('carer-1', 't1', {
      clock_out_at: CLOCK_OUT_UTC,
    });

    expect(updated.status).toBe('submitted');
    expect(timeEntryRepo.update).toHaveBeenCalled();
  });

  it('tries the strict active-membership gate FIRST — the relaxed one is the fallback', async () => {
    const { svc, queries } = makeServiceForRemovedMember(runningEntry);

    await svc.clockOut('carer-1', 't1', { clock_out_at: CLOCK_OUT_UTC });

    expect(queries.getOwnedTimeEntry).toHaveBeenCalledWith('carer-1', 't1');
  });

  it('still refuses an entry that is not hers', async () => {
    const { svc } = makeServiceForRemovedMember({
      ...runningEntry,
      carer_id: 'somebody-else',
    });

    await expect(
      svc.clockOut('carer-1', 't1', { clock_out_at: CLOCK_OUT_UTC })
    ).rejects.toThrow(TimeEntryNotFoundError);
  });

  it('still refuses a stranger, who has no membership row at all', async () => {
    const { svc, memberRepo } = makeServiceForRemovedMember(runningEntry);
    memberRepo.findMembershipAnyStatus.mockImplementation(async () => null);

    await expect(
      svc.clockOut('carer-1', 't1', { clock_out_at: CLOCK_OUT_UTC })
    ).rejects.toThrow(TimeEntryNotFoundError);
  });

  it('still refuses an entry that is not running — this is not a correction path', async () => {
    const { svc } = makeServiceForRemovedMember({
      ...runningEntry,
      status: 'submitted',
      clock_out_at: CLOCK_OUT_UTC,
    });

    await expect(
      svc.clockOut('carer-1', 't1', { clock_out_at: CLOCK_OUT_UTC })
    ).rejects.toThrow(TimeEntryNotFoundError);
  });
});

describe('clockIn — still shut', () => {
  it('refuses a removed member: closing a record is not starting one', async () => {
    const { svc, timeEntryRepo } = makeServiceForRemovedMember(runningEntry);

    await expect(
      svc.clockIn('carer-1', { household_id: 'h1' })
    ).rejects.toThrow(NotACarerError);

    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });
});

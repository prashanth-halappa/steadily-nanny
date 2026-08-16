/**
 * @module tests/unit/domains/timesheet/services/timesheetCommandService.termsGate
 *
 * The hard block (direction doc A1) as a POLICY ON TIME RECORDS, not a button
 * state. Three write paths carry it — `clockIn`, `createRetroactiveEntry` and
 * `updateEntry` — because gating only the clock-in button would leave "Add
 * missed hours" as a silent bypass, which is exactly the hole §3's footnote
 * calls out.
 *
 * `clockOut` is the deliberate exception and is pinned here too: a `running`
 * row created before terms lapsed (or before this change shipped) must always
 * be closeable, or the carer is stranded with an entry she cannot end and
 * `time_entries_one_running_per_carer` blocks every future clock-in.
 *
 * The date the gate is asked about is the household-LOCAL one. The fixtures
 * use Pacific/Auckland at 21:00 UTC, where local (2026-08-15) and UTC
 * (2026-08-14) dates genuinely differ — a gate fed the UTC date would refuse a
 * legitimate morning clock-in on the first day terms are in force.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const CLOCK_IN_UTC = '2026-08-14T21:00:00.000Z'; // 09:00 on the 15th in NZ
const LOCAL_DATE = '2026-08-15';
const UTC_DATE = '2026-08-14';
const TZ = 'Pacific/Auckland';

const household = { id: 'h1', timezone: TZ, week_starts_on: 1 };

const submittedEntry = {
  id: 't1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  shift_id: null,
  clock_in_at: CLOCK_IN_UTC,
  clock_out_at: '2026-08-15T01:00:00.000Z',
  break_minutes: 0,
  scheduled_minutes: null,
  kind: 'worked',
  note: null,
  status: 'submitted',
  local_date: LOCAL_DATE,
  timezone: TZ,
  created_at: 't',
  updated_at: 't',
};
const runningEntry = {
  ...submittedEntry,
  clock_out_at: null,
  status: 'running',
};

let TimesheetCommandService: typeof import('../../../../../src/domains/timesheet/services/timesheetCommandService').TimesheetCommandService;
let TermsNotAgreedError: typeof import('../../../../../src/domains/pay/errors/payErrors').TermsNotAgreedError;
let assertAgreed: ReturnType<typeof mock>;

beforeAll(async () => {
  assertAgreed = mock(async (..._args: unknown[]) => undefined);
  // Registered BEFORE the dynamic import below (docs/09-TESTING.md §4) so the
  // constructor's default 11th argument resolves to this stub rather than the
  // real singleton and its Supabase-backed repository.
  mock.module(
    '../../../../../src/domains/pay/services/termsGateService',
    () => ({
      termsGateService: {
        assertAgreed: (...args: unknown[]) => assertAgreed(...args),
      },
      TermsGateService: class {},
    })
  );

  TimesheetCommandService = (
    await import(
      '../../../../../src/domains/timesheet/services/timesheetCommandService'
    )
  ).TimesheetCommandService;
  TermsNotAgreedError = (
    await import('../../../../../src/domains/pay/errors/payErrors')
  ).TermsNotAgreedError;
});

beforeEach(() => {
  assertAgreed.mockClear();
  assertAgreed.mockImplementation(async () => undefined);
});

/** Terms are not in force: every gated path must refuse before writing. */
function refuseTerms() {
  assertAgreed.mockImplementation(async (householdId, carerId) => {
    throw new TermsNotAgreedError(householdId as string, carerId as string);
  });
}

type Any = any;

function makeService(overrides: Record<string, Any> = {}) {
  const timeEntryRepo: Any = {
    findRunningForCarer: mock(async () => null),
    clockIn: mock(async () => ({ ...runningEntry })),
    createSubmitted: mock(async () => ({ ...submittedEntry })),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      ...submittedEntry,
      ...patch,
    })),
    listForCarerWeek: mock(async () => []),
    listOverlapCandidatesForCarer: mock(async () => []),
    ...(overrides.timeEntryRepo ?? {}),
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
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'carer-1',
      role: 'nanny',
    })),
  };
  const householdRepo: Any = { findById: mock(async () => household) };
  const shiftRepo: Any = {
    findById: mock(async () => null),
    findByHouseholdAndRange: mock(async () => []),
  };
  const queries: Any = {
    getOwnedTimeEntry: mock(async () => ({ ...submittedEntry })),
    getOwnedTimesheet: mock(async () => null),
    ...(overrides.queries ?? {}),
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
  return { svc, timeEntryRepo, timesheetRepo, queries, householdRepo };
}

describe('clockIn — hard block, no escape hatch', () => {
  it('refuses with TermsNotAgreedError and writes nothing', async () => {
    refuseTerms();
    const { svc, timeEntryRepo } = makeService();

    await expect(
      svc.clockIn(
        'carer-1',
        { household_id: 'h1' },
        () => new Date(CLOCK_IN_UTC)
      )
    ).rejects.toThrow(TermsNotAgreedError);

    expect(timeEntryRepo.clockIn).not.toHaveBeenCalled();
  });

  it('asks the gate about the household-LOCAL date of the clock-in instant', async () => {
    refuseTerms();
    const { svc } = makeService();

    await svc
      .clockIn('carer-1', { household_id: 'h1' }, () => new Date(CLOCK_IN_UTC))
      .catch(() => undefined);

    expect(assertAgreed).toHaveBeenCalledWith('h1', 'carer-1', LOCAL_DATE);
    expect(assertAgreed).not.toHaveBeenCalledWith('h1', 'carer-1', UTC_DATE);
  });

  it('clocks in as before once terms are in force', async () => {
    const { svc, timeEntryRepo } = makeService();

    await svc.clockIn(
      'carer-1',
      { household_id: 'h1' },
      () => new Date(CLOCK_IN_UTC)
    );

    expect(timeEntryRepo.clockIn).toHaveBeenCalled();
  });
});

describe('createRetroactiveEntry — the bypass that would have defeated A1', () => {
  const input = {
    household_id: 'h1',
    clock_in_at: CLOCK_IN_UTC,
    clock_out_at: '2026-08-15T01:00:00.000Z',
  };

  it('refuses with TermsNotAgreedError and writes nothing', async () => {
    refuseTerms();
    const { svc, timeEntryRepo } = makeService();

    await expect(svc.createRetroactiveEntry('carer-1', input)).rejects.toThrow(
      TermsNotAgreedError
    );

    expect(timeEntryRepo.createSubmitted).not.toHaveBeenCalled();
  });

  it('asks about the local date of the hours being added, not today', async () => {
    refuseTerms();
    const { svc } = makeService();

    await svc.createRetroactiveEntry('carer-1', input).catch(() => undefined);

    expect(assertAgreed).toHaveBeenCalledWith('h1', 'carer-1', LOCAL_DATE);
  });
});

describe('updateEntry — a correction is a write too', () => {
  it('refuses with TermsNotAgreedError and writes nothing', async () => {
    refuseTerms();
    const { svc, timeEntryRepo } = makeService();

    await expect(
      svc.updateEntry('carer-1', 't1', { break_minutes: 30 })
    ).rejects.toThrow(TermsNotAgreedError);

    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });

  it("asks about the entry's own household, carer and original local date", async () => {
    refuseTerms();
    const { svc } = makeService();

    await svc
      .updateEntry('carer-1', 't1', { break_minutes: 30 })
      .catch(() => undefined);

    expect(assertAgreed).toHaveBeenCalledWith('h1', 'carer-1', LOCAL_DATE);
  });
});

describe('clockOut — deliberately NOT gated', () => {
  it('closes a running entry even while the gate refuses', async () => {
    refuseTerms();
    const { svc, timeEntryRepo } = makeService({
      queries: { getOwnedTimeEntry: mock(async () => ({ ...runningEntry })) },
    });

    const updated = await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-15T01:00:00.000Z',
    });

    expect(updated.status).toBe('submitted');
    expect(timeEntryRepo.update).toHaveBeenCalled();
    expect(assertAgreed).not.toHaveBeenCalled();
  });
});

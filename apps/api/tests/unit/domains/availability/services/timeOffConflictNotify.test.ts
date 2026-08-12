/**
 * Time-off create/update must scan overlapping confirmed shifts and push
 * each affected household's parents with THAT household's count only.
 *
 * mock.module registers the notification barrel before the dynamic import so
 * the service's default notify import is a no-op; each test still injects its
 * own notify spy via the constructor for assertion.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { CarerTimeOff } from '../../../../../src/domains/availability/types';
import type { HouseholdMember } from '../../../../../src/domains/household/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const row: CarerTimeOff = {
  id: 't1',
  user_id: 'nanny-1',
  // Anchored to Date.now(): `update()`'s "reject edits to past time off"
  // check compares this row's ends_at against the real clock, and a fixed
  // 2026 literal is exactly the timebomb that check catches — it already
  // tripped once (see the identical fix in timeOffCommandService.test.ts).
  starts_at: new Date(Date.now() + 28 * DAY_MS).toISOString(),
  ends_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
  all_day: true,
  kind: 'personal',
  message: null,
  status: 'confirmed',
  ical_uid: 'ical-1',
  sequence: 0,
  created_at: 't',
  updated_at: 't',
};

let TimeOffCommandService: typeof import('../../../../../src/domains/availability/services/timeOffCommandService').TimeOffCommandService;
let buildSickShiftsAffectedPush: typeof import('../../../../../src/domains/availability/services/timeOffCommandService').buildSickShiftsAffectedPush;

beforeAll(async () => {
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents: mock(() => undefined),
    notifyUser: mock(() => undefined),
  }));

  ({ TimeOffCommandService, buildSickShiftsAffectedPush } = await import(
    '../../../../../src/domains/availability/services/timeOffCommandService'
  ));
});

function makeTimeOffRepo(overrides: Record<string, unknown> = {}) {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...row,
      ...data,
      id: 't-new',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...row,
      id,
      ...data,
    })),
    cancelById: mock(async (id: string) => ({
      ...row,
      id,
      status: 'cancelled',
    })),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}) {
  return {
    getOwned: mock(async () => row),
    assertActiveMember: mock(async () => undefined),
    ...overrides,
  };
}

function makeOverlapRepo(
  shifts: Array<{
    id: string;
    household_id: string;
    starts_at?: string;
    local_date?: string;
    timezone?: string;
  }>
) {
  return {
    listConfirmedForCarerInRange: mock(async () => shifts),
  };
}

function makeMemberRepo(memberships: HouseholdMember[] = []) {
  return {
    listActiveByUser: mock(async () => memberships),
  };
}

describe('TimeOffCommandService.create — conflict scan', () => {
  it('creates over 3 booked shifts in 2 households → 2 pushes with per-household counts, no cross-household leak', async () => {
    const shifts = [
      { id: 's1', household_id: 'hh-reyes' },
      { id: 's2', household_id: 'hh-reyes' },
      { id: 's3', household_id: 'hh-other' },
    ];
    const notify = mock(() => undefined);
    const overlapRepo = makeOverlapRepo(shifts);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
      all_day: true,
    });

    expect(result.affected_shift_count).toBe(3);
    expect(result.carer_time_off.id).toBe('t-new');
    expect(overlapRepo.listConfirmedForCarerInRange).toHaveBeenCalledWith(
      'nanny-1',
      '2026-08-10T00:00:00Z',
      '2026-08-12T00:00:00Z'
    );
    expect(notify).toHaveBeenCalledTimes(2);

    const calls = notify.mock.calls as unknown as [
      string,
      { title: string; body: string; data: Record<string, unknown> },
    ][];
    const byHousehold = new Map(
      calls.map(([householdId, payload]) => [householdId, payload])
    );

    expect(byHousehold.get('hh-reyes')?.data).toEqual(
      expect.objectContaining({
        type: PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT,
        householdId: 'hh-reyes',
        affectedShiftCount: 2,
      })
    );
    expect(byHousehold.get('hh-other')?.data).toEqual(
      expect.objectContaining({
        type: PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT,
        householdId: 'hh-other',
        affectedShiftCount: 1,
      })
    );

    for (const [householdId, payload] of byHousehold) {
      const serialized = JSON.stringify(payload);
      for (const otherId of ['hh-reyes', 'hh-other']) {
        if (otherId === householdId) continue;
        expect(serialized).not.toContain(otherId);
      }
      if (householdId === 'hh-reyes') {
        expect(payload.data.affectedShiftCount).toBe(2);
      } else {
        expect(payload.data.affectedShiftCount).toBe(1);
      }
    }
  });

  it('creates with no overlapping shifts → no conflict push, affected_shift_count 0', async () => {
    const notify = mock(() => undefined);
    const overlapRepo = makeOverlapRepo([]);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(result.affected_shift_count).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('push failure still returns the created row (write is not failed)', async () => {
    const notify = mock(() => {
      throw new Error('expo down');
    });
    const overlapRepo = makeOverlapRepo([{ id: 's1', household_id: 'hh-1' }]);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(result.carer_time_off.id).toBe('t-new');
    expect(result.affected_shift_count).toBe(1);
  });

  it('scan lookup failure still returns the created row with affected_shift_count 0', async () => {
    const notify = mock(() => undefined);
    const overlapRepo = {
      listConfirmedForCarerInRange: mock(async () => {
        throw new Error('db down');
      }),
    };
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(result.carer_time_off.id).toBe('t-new');
    expect(result.affected_shift_count).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SICK-DAY COPY (068). The conflict push is the ONLY place a family learns
// that a booked shift is about to go uncovered, so it has to say which thing
// happened: "she has taken time off" (planned, weeks out, plan around it) and
// "she has called in sick" (today, right now, find cover) are different
// messages to different urgencies. The personal wording is pinned verbatim in
// the same block — branching on kind must not disturb the copy every existing
// family already receives.
//
// Not tested here because it is deliberately NOT built: nothing demotes or
// cancels the affected shifts. They stay confirmed and the parent decides —
// cancellation has pay consequences (cancellation_paid).
// ---------------------------------------------------------------------------
describe('TimeOffCommandService — conflict push copy by kind', () => {
  function pushFor(
    calls: unknown[][],
    householdId: string
  ): { title: string; body: string; data: Record<string, unknown> } {
    const call = (
      calls as [string, { title: string; body: string; data: never }][]
    ).find(([id]) => id === householdId);
    if (!call) throw new Error(`no push for ${householdId}`);
    return call[1];
  }

  // -------------------------------------------------------------------------
  // D-23 / S10 SUPERSEDES 068's SICK ARM OF THIS PUSH.
  //
  // 068 branched `carer_time_off_conflict`'s copy on kind, which was right for
  // what existed then: nothing cancelled the overlapping shifts, so the push
  // was the family's only signal and had to carry the urgency itself. D-23
  // changes the underlying act — a sick day now auto-opens a cancel change
  // request per overlapping shift — and matrix row N10 says the whole thing
  // gets ONE push, not `time_off_requested` plus N × `shift_change_requested`
  // plus a conflict push (A6). So on the sick-with-overlap path the conflict
  // push is not re-worded, it is REPLACED.
  //
  // The personal-kind pins below are untouched and must stay byte-identical:
  // planned time off still cancels nothing, so its push is still the whole
  // signal.
  // -------------------------------------------------------------------------
  it('a SICK time off over 1 shift emits N10 only — one fact, one push', async () => {
    const notify = mock(() => undefined);
    const openCancel = mock(async () => undefined);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      makeOverlapRepo([
        {
          id: 's1',
          household_id: 'hh-reyes',
          starts_at: '2026-08-11T08:00:00Z',
          local_date: '2026-08-11',
          timezone: 'UTC',
        },
      ]) as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never,
      openCancel
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-11T08:00:00Z',
      ends_at: '2026-08-11T18:00:00Z',
      kind: 'sick',
    });

    // The cancel request is opened on her behalf — S10's missing path.
    expect(openCancel).toHaveBeenCalledTimes(1);
    expect(openCancel).toHaveBeenCalledWith('s1', 'nanny-1');
    expect(result.affected_shift_count).toBe(1);

    // Exactly one push for the household, and it is N10.
    expect(notify.mock.calls).toHaveLength(1);
    const payload = pushFor(notify.mock.calls, 'hh-reyes');
    expect(payload.data).toEqual(
      expect.objectContaining({
        type: PUSH_NOTIFICATION_TYPES.CARER_SICK_SHIFTS_AFFECTED,
        householdId: 'hh-reyes',
        affectedShiftCount: 1,
      })
    );
    expect(payload.body).toContain('1 shift');
    expect(payload.body).toContain('Tue 11 Aug');
    // The holiday-request phrasing must be nowhere near a sick day.
    expect(payload.body).not.toContain('taken time off');
  });

  it('a SICK time off over several shifts still emits ONE push, naming the count and the earliest date', async () => {
    const notify = mock(() => undefined);
    const openCancel = mock(async () => undefined);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      makeOverlapRepo([
        // Deliberately out of order: the body must name the EARLIEST.
        {
          id: 's2',
          household_id: 'hh-reyes',
          starts_at: '2026-08-12T08:00:00Z',
          local_date: '2026-08-12',
          timezone: 'UTC',
        },
        {
          id: 's1',
          household_id: 'hh-reyes',
          starts_at: '2026-08-11T08:00:00Z',
          local_date: '2026-08-11',
          timezone: 'UTC',
        },
      ]) as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never,
      openCancel
    );

    await svc.create('nanny-1', {
      starts_at: '2026-08-11T08:00:00Z',
      ends_at: '2026-08-12T18:00:00Z',
      kind: 'sick',
    });

    expect(openCancel).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls).toHaveLength(1);
    const payload = pushFor(notify.mock.calls, 'hh-reyes');
    expect(payload.body).toContain('2 shifts');
    expect(payload.body).toContain('Tue 11 Aug');
  });

  // GOLDEN #25: `starts_at` serialisations mix — an offset form ('+02:00',
  // or Postgres's '+00:00') alongside toISOString's '.000Z'. localeCompare
  // orders the STRINGS, so an offset-serialised shift that is temporally
  // earliest can rank last and N10's body names the wrong date.
  it('names the earliest shift by instant, not by string, when serialisations mix', () => {
    const push = buildSickShiftsAffectedPush('hh-reyes', [
      {
        id: 's-late',
        household_id: 'hh-reyes',
        starts_at: '2026-08-11T23:00:00.000Z',
        local_date: '2026-08-11',
        timezone: 'UTC',
      },
      {
        // 22:30Z — the actual earliest, but '2026-08-12…' string-ranks last.
        id: 's-early',
        household_id: 'hh-reyes',
        starts_at: '2026-08-12T00:30:00+02:00',
        local_date: '2026-08-12',
        timezone: 'Europe/Berlin',
      },
    ]);

    expect(push.body).toContain('Wed 12 Aug');
    expect(push.data?.localDate).toBe('2026-08-12');
  });

  it('a SICK time off overlapping NOTHING falls back to time_off_requested, as today', async () => {
    const notify = mock(() => undefined);
    const openCancel = mock(async () => undefined);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      makeOverlapRepo([]) as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never,
      openCancel
    );

    await svc.create('nanny-1', {
      starts_at: '2026-08-11T08:00:00Z',
      ends_at: '2026-08-11T18:00:00Z',
      kind: 'sick',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(openCancel).not.toHaveBeenCalled();
  });

  it('one cancel request failing to open never abandons the rest, and never fails her sick day', async () => {
    const notify = mock(() => undefined);
    const openCancel = mock(async (shiftId: string) => {
      if (shiftId === 's-bad') throw new Error('rpc unreachable');
      return undefined;
    });
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      makeOverlapRepo([
        {
          id: 's-bad',
          household_id: 'hh-reyes',
          starts_at: '2026-08-11T08:00:00Z',
          local_date: '2026-08-11',
          timezone: 'UTC',
        },
        {
          id: 's-good',
          household_id: 'hh-reyes',
          starts_at: '2026-08-12T08:00:00Z',
          local_date: '2026-08-12',
          timezone: 'UTC',
        },
      ]) as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never,
      openCancel
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-11T08:00:00Z',
      ends_at: '2026-08-12T18:00:00Z',
      kind: 'sick',
    });

    expect(openCancel).toHaveBeenCalledTimes(2);
    // Only the ones that actually opened are counted or announced.
    expect(result.affected_shift_count).toBe(1);
    expect(pushFor(notify.mock.calls, 'hh-reyes').body).toContain('1 shift');
  });

  // Byte-identical regression pin for every family already on the app.
  it('a PERSONAL time off keeps the pre-068 wording, singular and plural', async () => {
    const notify = mock(() => undefined);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      makeOverlapRepo([
        { id: 's1', household_id: 'hh-one' },
        { id: 's2', household_id: 'hh-many' },
        { id: 's3', household_id: 'hh-many' },
      ]) as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
      all_day: true,
    });

    const single = pushFor(notify.mock.calls, 'hh-one');
    expect(single.title).toBe('Carer time off overlaps shifts');
    expect(single.body).toBe(
      'Your carer has taken time off that overlaps 1 booked shift.'
    );
    expect(single.data).toEqual(
      expect.objectContaining({ kind: 'personal', affectedShiftCount: 1 })
    );

    const plural = pushFor(notify.mock.calls, 'hh-many');
    expect(plural.title).toBe('Carer time off overlaps shifts');
    expect(plural.body).toBe(
      'Your carer has taken time off that overlaps 2 booked shifts.'
    );
  });

  it('an UPDATE of a sick row re-pushes with the sickness copy', async () => {
    const notify = mock(() => undefined);
    const sickRow: CarerTimeOff = {
      ...row,
      kind: 'sick',
      starts_at: new Date(Date.now() + 3_600_000).toISOString(),
      ends_at: new Date(Date.now() + 7_200_000).toISOString(),
    };
    const svc = new TimeOffCommandService(
      makeTimeOffRepo({
        // The repo returns the row as it now stands in the database.
        update: mock(async (id: string, data: Record<string, unknown>) => ({
          ...sickRow,
          id,
          ...data,
        })),
      }) as never,
      makeQueries({ getOwned: mock(async () => sickRow) }) as never,
      makeOverlapRepo([{ id: 's1', household_id: 'hh-a' }]) as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    await svc.update('nanny-1', 't1', { message: 'still unwell' });

    const payload = pushFor(notify.mock.calls, 'hh-a');
    expect(payload.title).toBe('Carer has called in sick');
    expect(payload.body).toBe(
      'Your carer has called in sick and will miss 1 booked shift.'
    );
  });
});

describe('TimeOffCommandService.update — conflict scan', () => {
  it('re-scans the effective range and pushes per-household counts', async () => {
    const notify = mock(() => undefined);
    const overlapRepo = makeOverlapRepo([
      { id: 's1', household_id: 'hh-a' },
      { id: 's2', household_id: 'hh-a' },
    ]);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.update('nanny-1', 't1', {
      starts_at: '2026-08-11T00:00:00Z',
      ends_at: '2026-08-13T00:00:00Z',
    });

    expect(result.affected_shift_count).toBe(2);
    expect(overlapRepo.listConfirmedForCarerInRange).toHaveBeenCalledWith(
      'nanny-1',
      '2026-08-11T00:00:00Z',
      '2026-08-13T00:00:00Z'
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'hh-a',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT,
          affectedShiftCount: 2,
        }),
      })
    );
  });
});

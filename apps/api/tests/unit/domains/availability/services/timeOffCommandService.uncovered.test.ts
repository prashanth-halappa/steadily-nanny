/**
 * D77a — time off demotes the confirmed shifts it overlaps to `pending`.
 *
 * `pending` is already excluded from `COVERING_SHIFT_STATUSES`
 * (packages/shared-types/src/uncoveredCare.ts), so this is the whole fix:
 * zero changes to `computeUncovered`, and no stored coverage flag
 * (docs/12-NEED-COVERAGE.md §4). What these tests pin is that
 * `TimeOffCommandService` actually drives that demote — per overlapping
 * shift, via a conditional `demoteConfirmedToPending` (never read-then-
 * write), with one `shift_events` audit row per shift THIS call actually
 * transitioned.
 */
import { describe, expect, it, mock } from 'bun:test';
import { TimeOffCommandService } from '../../../../../src/domains/availability/services/timeOffCommandService';
import type { CarerTimeOff } from '../../../../../src/domains/availability/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const CREATE_START = new Date(Date.now() + 28 * DAY_MS).toISOString();
const CREATE_END = new Date(Date.now() + 30 * DAY_MS).toISOString();
const UPDATE_START = new Date(Date.now() + 27 * DAY_MS).toISOString();
const UPDATE_END = new Date(Date.now() + 31 * DAY_MS).toISOString();

const row: CarerTimeOff = {
  id: 't1',
  user_id: 'carer-1',
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

const CONFIRMED_SHIFT = {
  id: 'shift-1',
  household_id: 'hh-1',
  starts_at: CREATE_START,
  local_date: '2026-09-20',
  timezone: 'UTC',
};

function makeTimeOffRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...row,
      ...data,
      id: 't-new',
    })),
    cancelById: mock(async (id: string) => ({
      ...row,
      id,
      status: 'cancelled',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...row,
      id,
      ...data,
    })),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => row),
    assertActiveMember: mock(async () => undefined),
    ...overrides,
  };
}

/** `demoteConfirmedToPending` defaults to `true` — every shift transitions. */
function makeOverlapRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listConfirmedForCarerInRange: mock(async () => [CONFIRMED_SHIFT]),
    demoteConfirmedToPending: mock(async () => true),
    ...overrides,
  };
}

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    insertMany: mock(async (events: unknown[]) => events),
    ...overrides,
  };
}

/**
 * Builds a service with every non-tested seam stubbed to a no-op, so a test
 * asserting on the demote path is never incidentally driven by a sibling
 * effect (push, sick-cancel RPC, requested-push fan-out).
 */
function makeSvc(args: {
  timeOffRepo?: unknown;
  queries?: unknown;
  overlapRepo?: unknown;
  eventRepo?: unknown;
}): TimeOffCommandService {
  return new TimeOffCommandService(
    (args.timeOffRepo ?? makeTimeOffRepo()) as never,
    (args.queries ?? makeQueries()) as never,
    (args.overlapRepo ?? makeOverlapRepo()) as never,
    mock(() => undefined), // notifyParents
    mock(async () => undefined), // reconcilePtoUsage
    { listActiveByUser: mock(async () => []) } as never, // memberRepo
    mock(async () => undefined), // openCancelRequest — D-23 RPC, stubbed
    (args.eventRepo ?? makeEventRepo()) as never
  );
}

describe('TimeOffCommandService — D77a demote on overlap (create)', () => {
  it('demotes an overlapping confirmed shift and writes one audit event, personal kind', async () => {
    const overlapRepo = makeOverlapRepo();
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ overlapRepo, eventRepo });

    await svc.create('carer-1', {
      starts_at: CREATE_START,
      ends_at: CREATE_END,
      all_day: true,
    });

    expect(overlapRepo.demoteConfirmedToPending).toHaveBeenCalledWith(
      'shift-1'
    );
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        household_id: 'hh-1',
        shift_id: 'shift-1',
        local_date: '2026-09-20',
        actor_id: 'carer-1',
        event_type: 'shift_demoted_time_off',
        payload: expect.objectContaining({
          previous_status: 'confirmed',
          status: 'pending',
          kind: 'personal',
        }),
      }),
    ]);
  });

  it('demotes an overlapping confirmed shift for a sick day too', async () => {
    const overlapRepo = makeOverlapRepo();
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ overlapRepo, eventRepo });

    await svc.create('carer-1', {
      starts_at: CREATE_START,
      ends_at: CREATE_END,
      all_day: true,
      kind: 'sick',
    });

    expect(overlapRepo.demoteConfirmedToPending).toHaveBeenCalledWith(
      'shift-1'
    );
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        event_type: 'shift_demoted_time_off',
        payload: expect.objectContaining({ kind: 'sick' }),
      }),
    ]);
  });

  it('leaves a non-overlapping shift untouched — the repo returned nothing to demote', async () => {
    const overlapRepo = makeOverlapRepo({
      listConfirmedForCarerInRange: mock(async () => []),
    });
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ overlapRepo, eventRepo });

    await svc.create('carer-1', {
      starts_at: CREATE_START,
      ends_at: CREATE_END,
      all_day: true,
    });

    expect(overlapRepo.demoteConfirmedToPending).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });

  it("leaves a different carer's shift untouched — never in the overlap result for this carer", async () => {
    // OverlappingShiftRepository.listConfirmedForCarerInRange already scopes
    // by carer_id server-side; a shift belonging to someone else is simply
    // never in the array the service receives.
    const overlapRepo = makeOverlapRepo({
      listConfirmedForCarerInRange: mock(async () => []),
    });
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ overlapRepo, eventRepo });

    await svc.create('carer-1', {
      starts_at: CREATE_START,
      ends_at: CREATE_END,
      all_day: true,
    });

    expect(overlapRepo.listConfirmedForCarerInRange).toHaveBeenCalledWith(
      'carer-1',
      CREATE_START,
      CREATE_END
    );
    expect(overlapRepo.demoteConfirmedToPending).not.toHaveBeenCalled();
  });

  it('leaves an already-pending shift alone — the conditional update is a no-op, no audit row', async () => {
    const overlapRepo = makeOverlapRepo({
      demoteConfirmedToPending: mock(async () => false),
    });
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ overlapRepo, eventRepo });

    await svc.create('carer-1', {
      starts_at: CREATE_START,
      ends_at: CREATE_END,
      all_day: true,
    });

    expect(overlapRepo.demoteConfirmedToPending).toHaveBeenCalledWith(
      'shift-1'
    );
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });

  it('never fails the time-off write when the demote itself throws', async () => {
    const overlapRepo = makeOverlapRepo({
      demoteConfirmedToPending: mock(async () => {
        throw new Error('db unavailable');
      }),
    });
    const svc = makeSvc({ overlapRepo });

    const result = await svc.create('carer-1', {
      starts_at: CREATE_START,
      ends_at: CREATE_END,
      all_day: true,
    });

    expect(result.carer_time_off.id).toBe('t-new');
  });
});

describe('TimeOffCommandService — D77a demote on overlap (update)', () => {
  it('widening the range on PATCH demotes newly-overlapped shifts', async () => {
    const overlapRepo = makeOverlapRepo();
    const eventRepo = makeEventRepo();
    const queries = makeQueries();
    const svc = makeSvc({ queries, overlapRepo, eventRepo });

    await svc.update('carer-1', 't1', {
      starts_at: UPDATE_START,
      ends_at: UPDATE_END,
    });

    // The demote scan runs against the EFFECTIVE (post-update) range.
    expect(overlapRepo.listConfirmedForCarerInRange).toHaveBeenCalledWith(
      'carer-1',
      UPDATE_START,
      UPDATE_END
    );
    expect(overlapRepo.demoteConfirmedToPending).toHaveBeenCalledWith(
      'shift-1'
    );
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ event_type: 'shift_demoted_time_off' }),
    ]);
  });
});

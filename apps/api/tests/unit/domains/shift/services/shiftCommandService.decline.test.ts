/**
 * ShiftCommandService.decline — the carer's symmetric "no" to `accept`
 * (Wave 1B). Same gate (assigned carer only, same not-found shape for
 * missing / non-member / wrong-carer), same soft `assertMutable` preflight +
 * CAS write, and the same fire-and-forget day-thread event.
 *
 * Unlike accept, `declined` is TERMINAL: there is no transition back to
 * pending, so the `shift_declined` event is keyed (migration 025) — see the
 * service's comment.
 *
 * mock.module BEFORE the dynamic import so the notification barrel is stubbed
 * (this file asserts the WRITE side; payload exactness lives in
 * `shiftCommandService.decline.pushes.test.ts`).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  ShiftImmutableError,
  ShiftNotFoundError,
} from '../../../../../src/domains/shift/errors/shiftErrors';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import { ValidationError } from '../../../../../src/errors';

const pendingShift: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T08:00:00.000Z',
  ends_at: '2026-08-03T17:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2026-08-03',
  kind: 'extra',
  status: 'pending',
  source_pattern_id: null,
  origin: 'parent_proposed',
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
  shift_children: [],
};

let ShiftCommandService: typeof import('../../../../../src/domains/shift/services/shiftCommandService').ShiftCommandService;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate: mock(async () => ({
        inserted: [],
        pushed: [],
      })),
      detectUncoveredCareBestEffort: mock(() => undefined),
    })
  );
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser: mock(() => undefined),
    notifyHouseholdParents,
  }));

  ({ ShiftCommandService } = await import(
    '../../../../../src/domains/shift/services/shiftCommandService'
  ));
});

beforeEach(() => {
  notifyHouseholdParents.mockClear();
});

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  const assertMutable = mock(async (_id: string) => undefined);
  return {
    assertMutable,
    declinePending: mock(async (id: string) => {
      await assertMutable(id);
      return { ...pendingShift, id, status: 'declined' };
    }),
    ...overrides,
  };
}

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    insertMany: mock(async () => []),
    ...overrides,
  };
}

function makeCarerMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm2',
      household_id: 'h1',
      user_id: 'carer-1',
      role: 'nanny',
    })),
    ...overrides,
  };
}

function makeQueries(
  shift: ShiftWithChildren = pendingShift,
  overrides: Record<string, unknown> = {}
): any {
  return {
    getOwned: mock(async () => shift),
    ...overrides,
  };
}

/**
 * `pendingShift.kind` is `'extra'`, so every successful decline in this file
 * takes the `isAskDecline` push branch — deliberately NOT awaited by
 * `decline()` (same reasoning as `shiftCommandService.decline.pushes.test.ts`'s
 * `flushPush`). Without draining the queue here, that push lands a microtask
 * into whichever test runs next and inflates ITS `notifyHouseholdParents`
 * count — exactly what made "refuses to decline a %s shift" flaky under load
 * (2 leaked calls from the two tests above it, landing after that test's own
 * `mockClear()`).
 */
async function flushPush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('ShiftCommandService.decline', () => {
  it('lets the assigned carer decline a pending shift and writes a day-thread event', async () => {
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeCarerMemberRepo(),
      makeQueries(pendingShift),
      eventRepo
    );

    const result = await svc.decline('carer-1', 's1');

    expect(shiftRepo.declinePending).toHaveBeenCalledWith('s1');
    expect(shiftRepo.assertMutable).toHaveBeenCalledWith('s1');
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      {
        household_id: 'h1',
        shift_id: 's1',
        local_date: '2026-08-03',
        actor_id: 'carer-1',
        event_type: 'shift_declined',
        payload: { previous_status: 'pending', key: 's1' },
      },
    ]);
    expect(result.status).toBe('declined');
    await flushPush();
  });

  it('still returns the declined shift when the day-thread event write fails', async () => {
    // declinePending has already committed by then — failing the request would
    // 500 on a shift that IS declined, and the retry 400s SHIFT_NOT_PENDING.
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeCarerMemberRepo(),
      makeQueries(pendingShift),
      makeEventRepo({
        insertMany: mock(async () => {
          throw new Error('db down');
        }),
      })
    );

    const result = await svc.decline('carer-1', 's1');

    expect(result.status).toBe('declined');
    expect(shiftRepo.declinePending).toHaveBeenCalledWith('s1');
    await flushPush();
  });

  it.each([
    'draft',
    'confirmed',
    'declined',
    'cancelled',
    'completed',
  ])('refuses to decline a %s shift — pending is the ONLY source state', async status => {
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeCarerMemberRepo(),
      makeQueries({
        ...pendingShift,
        status: status as ShiftWithChildren['status'],
      }),
      eventRepo
    );

    await expect(svc.decline('carer-1', 's1')).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(shiftRepo.declinePending).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('carries the offending status in the refusal metadata', async () => {
    const svc = new ShiftCommandService(
      makeShiftRepo(),
      makeCarerMemberRepo(),
      makeQueries({ ...pendingShift, status: 'confirmed' }),
      makeEventRepo()
    );

    try {
      await svc.decline('carer-1', 's1');
      expect.unreachable('decline should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      // ValidationError's machine code is VALIDATION_ERROR; the domain reason
      // lives in metadata.reason — same shape as accept's SHIFT_NOT_PENDING.
      expect((error as ValidationError).metadata?.reason).toBe(
        'SHIFT_NOT_PENDING'
      );
      expect((error as ValidationError).metadata?.status).toBe('confirmed');
    }
  });

  it('rejects a parent with the same not-found-shaped error as a missing shift', async () => {
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeCarerMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm1',
          household_id: 'h1',
          user_id: 'parent-1',
          role: 'parent',
        })),
      }),
      makeQueries(pendingShift),
      eventRepo
    );

    await expect(svc.decline('parent-1', 's1')).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
    expect(shiftRepo.declinePending).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });

  it('rejects a DIFFERENT carer in the same household — assignment is never leaked', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeCarerMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm3',
          household_id: 'h1',
          user_id: 'carer-2',
          role: 'nanny',
        })),
      }),
      makeQueries(pendingShift),
      makeEventRepo()
    );

    await expect(svc.decline('carer-2', 's1')).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
    expect(shiftRepo.declinePending).not.toHaveBeenCalled();
  });

  it('rejects an unassigned shift rather than letting any nanny decline it', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeCarerMemberRepo(),
      makeQueries({ ...pendingShift, carer_id: null }),
      makeEventRepo()
    );

    await expect(svc.decline('carer-1', 's1')).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
    expect(shiftRepo.declinePending).not.toHaveBeenCalled();
  });

  it('rejects a caller with no active membership', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeCarerMemberRepo({
        findActiveMembership: mock(async () => null),
      }),
      makeQueries(pendingShift),
      makeEventRepo()
    );

    await expect(svc.decline('carer-1', 's1')).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
    expect(shiftRepo.declinePending).not.toHaveBeenCalled();
  });

  it('refuses to decline a shift someone has clocked into', async () => {
    // A declined shift drops out of the schedule and out of week earnings; a
    // shift with time entries is worked reality and must not be un-scheduled
    // out from under the timesheet.
    const assertMutable = mock(async (_id: string) => {
      throw new ShiftImmutableError('s1', 'pending', 'has_time_entries');
    });
    const shiftRepo = makeShiftRepo({
      assertMutable,
      declinePending: mock(async (id: string) => {
        await assertMutable(id);
        return { ...pendingShift, id, status: 'declined' };
      }),
    });
    const eventRepo = makeEventRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeCarerMemberRepo(),
      makeQueries(pendingShift),
      eventRepo
    );

    await expect(svc.decline('carer-1', 's1')).rejects.toBeInstanceOf(
      ShiftImmutableError
    );
    expect(shiftRepo.declinePending).toHaveBeenCalledWith('s1');
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });
});

/**
 * @module tests/unit/domains/shift/services/shiftCommandService.removeParentCover.test
 *
 * S13 — `DELETE /shifts/:sid/parent-cover` had a role check and NOTHING else:
 * it hard-deleted at any status, at any time, even with hours clocked against
 * it, and recorded nothing anywhere. This pins the three preconditions and the
 * day-thread row.
 *
 * S14 — `refreshDayThread` is the explicit, parent-only WRITE that replaces
 * the uncovered-care detection `listDayThread` used to do on a read.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import { ShiftImmutableError } from '../../../../../src/domains/shift/errors/shiftErrors';
import { ValidationError } from '../../../../../src/errors';

let ShiftCommandService: typeof import('../../../../../src/domains/shift/services/shiftCommandService').ShiftCommandService;
let detectMock: ReturnType<typeof mock>;

beforeAll(async () => {
  detectMock = mock(async () => ({ inserted: [], pushed: [] }));
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate: detectMock,
      detectUncoveredCareBestEffort: mock(() => undefined),
    })
  );
  ({ ShiftCommandService } = await import(
    '../../../../../src/domains/shift/services/shiftCommandService'
  ));
});

beforeEach(() => {
  detectMock.mockClear();
  detectMock.mockImplementation(async () => ({ inserted: [], pushed: [] }));
});

/** Far enough ahead that the "already started" guard never fires by accident. */
const FUTURE_START = '2099-08-03T09:00:00.000Z';

const parentCover = {
  id: 'pc1',
  household_id: 'h1',
  carer_id: null,
  starts_at: FUTURE_START,
  ends_at: '2099-08-03T12:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2099-08-03',
  kind: 'parent_cover' as const,
  status: 'confirmed' as const,
  source_pattern_id: null,
  origin: 'parent_cover' as const,
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'uid-pc1',
  sequence: 0,
  created_by: 'parent-1',
  created_at: 't',
  updated_at: 't',
  shift_children: [],
};

function makeSvc(overrides: Record<string, unknown> = {}) {
  const deleteShift = mock(async () => undefined);
  const assertMutable = mock(async () => undefined);
  const insertMany = mock(async () => []);
  return {
    svc: new ShiftCommandService(
      {
        delete: deleteShift,
        assertMutable,
        ...((overrides.shiftRepo as object) ?? {}),
      } as never,
      {
        findActiveMembership: mock(async () => ({
          id: 'm1',
          household_id: 'h1',
          user_id: 'parent-1',
          role: 'parent',
        })),
        ...((overrides.memberRepo as object) ?? {}),
      } as never,
      {
        getOwned: mock(async () => parentCover),
        ...((overrides.queries as object) ?? {}),
      } as never,
      { insertMany } as never,
      { getOwned: mock(async () => ({ id: 'child-1' })) } as never,
      { findById: mock(async () => ({ id: 'h1' })) } as never
    ),
    deleteShift,
    assertMutable,
    insertMany,
  };
}

describe('ShiftCommandService.removeParentCover — S13 preconditions', () => {
  it('removes a future, live parent-cover shift', async () => {
    const { svc, deleteShift } = makeSvc();
    await svc.removeParentCover('parent-1', 'pc1');
    expect(deleteShift).toHaveBeenCalledWith('pc1');
  });

  it('still refuses a shift that is not parent_cover', async () => {
    const { svc, deleteShift } = makeSvc({
      queries: {
        getOwned: mock(async () => ({ ...parentCover, kind: 'recurring' })),
      },
    });
    await expect(
      svc.removeParentCover('parent-1', 'pc1')
    ).rejects.toBeInstanceOf(ValidationError);
    expect(deleteShift).not.toHaveBeenCalled();
  });

  for (const status of [
    'draft',
    'cancelled',
    'completed',
    'declined',
  ] as const) {
    it(`refuses a ${status} parent-cover shift`, async () => {
      const { svc, deleteShift } = makeSvc({
        queries: { getOwned: mock(async () => ({ ...parentCover, status })) },
      });
      await expect(
        svc.removeParentCover('parent-1', 'pc1')
      ).rejects.toBeInstanceOf(ValidationError);
      expect(deleteShift).not.toHaveBeenCalled();
    });
  }

  it('refuses a parent-cover shift that has already started', async () => {
    const { svc, deleteShift } = makeSvc({
      queries: {
        getOwned: mock(async () => ({
          ...parentCover,
          starts_at: '2020-01-01T09:00:00.000Z',
          ends_at: '2020-01-01T12:00:00.000Z',
        })),
      },
    });
    await expect(
      svc.removeParentCover('parent-1', 'pc1')
    ).rejects.toBeInstanceOf(ValidationError);
    expect(deleteShift).not.toHaveBeenCalled();
  });

  it('refuses when anybody has clocked into it (assertMutable is the chokepoint)', async () => {
    const { svc, deleteShift } = makeSvc({
      shiftRepo: {
        assertMutable: mock(async () => {
          throw new ShiftImmutableError('pc1', 'confirmed', 'has_time_entries');
        }),
      },
    });
    await expect(
      svc.removeParentCover('parent-1', 'pc1')
    ).rejects.toBeInstanceOf(ShiftImmutableError);
    expect(deleteShift).not.toHaveBeenCalled();
  });

  it('refuses a non-parent caller before reading anything else', async () => {
    const { svc, deleteShift } = makeSvc({
      memberRepo: {
        findActiveMembership: mock(async () => ({
          id: 'm2',
          household_id: 'h1',
          user_id: 'nanny-1',
          role: 'nanny',
        })),
      },
    });
    await expect(
      svc.removeParentCover('nanny-1', 'pc1')
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(deleteShift).not.toHaveBeenCalled();
  });
});

describe('ShiftCommandService.removeParentCover — the day-thread row', () => {
  it('appends parent_cover_removed AFTER the delete, with a NULL shift_id', async () => {
    const { svc, insertMany } = makeSvc();

    await svc.removeParentCover('parent-1', 'pc1');

    expect(insertMany).toHaveBeenCalledWith([
      {
        household_id: 'h1',
        // NULL, not 'pc1': shift_events.shift_id is `on delete cascade`, so a
        // row pointing at the shift we just deleted could never survive.
        shift_id: null,
        local_date: '2099-08-03',
        actor_id: 'parent-1',
        event_type: 'parent_cover_removed',
        payload: { shiftId: 'pc1', removedBy: 'parent-1' },
      },
    ]);
  });

  it('still removes the cover when the day-thread append fails', async () => {
    const { svc, deleteShift } = makeSvc({});
    const failing = new ShiftCommandService(
      {
        delete: deleteShift,
        assertMutable: mock(async () => undefined),
      } as never,
      {
        findActiveMembership: mock(async () => ({
          id: 'm1',
          household_id: 'h1',
          user_id: 'parent-1',
          role: 'parent',
        })),
      } as never,
      { getOwned: mock(async () => parentCover) } as never,
      {
        insertMany: mock(async () => {
          throw new Error('shift_events is down');
        }),
      } as never,
      { getOwned: mock(async () => ({ id: 'child-1' })) } as never,
      { findById: mock(async () => ({ id: 'h1' })) } as never
    );

    await failing.removeParentCover('parent-1', 'pc1');
    expect(deleteShift).toHaveBeenCalledWith('pc1');
  });
});

describe('ShiftCommandService.refreshDayThread — S14', () => {
  it('runs uncovered-care detection for the requested date', async () => {
    const { svc } = makeSvc();

    await svc.refreshDayThread('parent-1', 'h1', '2026-08-03');

    expect(detectMock).toHaveBeenCalledWith({
      householdId: 'h1',
      localDate: '2026-08-03',
      cause: 'nothingScheduled',
      actorId: 'parent-1',
    });
  });

  it('refuses a nanny — this is a WRITE, not the read it replaced', async () => {
    const { svc } = makeSvc({
      memberRepo: {
        findActiveMembership: mock(async () => ({
          id: 'm2',
          household_id: 'h1',
          user_id: 'nanny-1',
          role: 'nanny',
        })),
      },
    });

    await expect(
      svc.refreshDayThread('nanny-1', 'h1', '2026-08-03')
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(detectMock).not.toHaveBeenCalled();
  });
});

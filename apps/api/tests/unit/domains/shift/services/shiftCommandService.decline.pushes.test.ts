/**
 * Push leg of the carer decline (Wave 1B). Parent-targeted: the family now
 * has a gap where they thought they had cover, and they cannot see the
 * refusal from the carer app.
 *
 * The `data` payload is a wire contract with the mobile deep-link route map
 * (`shiftDetailHref` reads `shiftId` + `householdId`), so it is asserted
 * field-exact here, not with `objectContaining`.
 *
 * mock.module BEFORE the dynamic import — see docs/09-TESTING.md.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

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
let notifyUser: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
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
    notifyUser,
    notifyHouseholdParents,
  }));

  ({ ShiftCommandService } = await import(
    '../../../../../src/domains/shift/services/shiftCommandService'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
  notifyHouseholdParents.mockImplementation(() => undefined);
});

function makeShiftRepo(): any {
  const assertMutable = mock(async (_id: string) => undefined);
  return {
    assertMutable,
    declinePending: mock(async (id: string) => {
      await assertMutable(id);
      return { ...pendingShift, id, status: 'declined' };
    }),
  };
}

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return { insertMany: mock(async () => []), ...overrides };
}

function makeCarerMemberRepo(): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm2',
      household_id: 'h1',
      user_id: 'carer-1',
      role: 'nanny',
    })),
    listActiveByHousehold: mock(async () => [
      { user_id: 'carer-1', profile_name: 'Ines', role: 'nanny' },
    ]),
  };
}

function makeQueries(overrides: Partial<ShiftWithChildren> = {}): any {
  return { getOwned: mock(async () => ({ ...pendingShift, ...overrides })) };
}

/**
 * The decline push copy now names the child, so the service reaches for
 * `ChildQueryService`. Its constructor default is the REAL one, which goes to
 * the network and never settles under test — leaving the push pending forever
 * rather than failing loudly. Inject a stub so the copy path is exercised
 * rather than hung.
 */
function makeChildren(): any {
  return {
    getOwned: mock(async () => ({ id: 'c1', name: 'Ada' })),
    listForHousehold: mock(async () => [{ id: 'c1', name: 'Ada' }]),
  };
}

function makeService(eventRepo = makeEventRepo()) {
  return new ShiftCommandService(
    makeShiftRepo(),
    makeCarerMemberRepo(),
    makeQueries(),
    eventRepo,
    makeChildren()
  );
}

/**
 * The decline push is deliberately NOT awaited by `decline()` — the enriched
 * copy needs a member and child lookup, and neither may sit on the critical
 * path of her saying no. That means the push lands a microtask later, so tests
 * must let the queue drain before asserting.
 */
async function flushPush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('ShiftCommandService.decline — pushes', () => {
  // -------------------------------------------------------------------------
  // N9 / D-22 (3-T3). The fixture is an `extra` shift — i.e. a cover ask — so
  // this now takes the `cover_ask_declined` leg. That is the whole point of
  // N9: under D-22 a pending ask no longer counts as cover, so the uncovered
  // push fires at ASK time, and A6 would have suppressed `shift_declined` on
  // every single cover-ask decline. The parent would never have learned she
  // said no. The enriched body is unchanged — only the type and title differ,
  // because the fact differs ("she answered", not "this window is uncovered").
  // -------------------------------------------------------------------------
  it('pushes cover_ask_declined exactly once for an ask, immune to A6 suppression', async () => {
    await makeService().decline('carer-1', 's1');
    await flushPush();

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [householdId, payload] = notifyHouseholdParents.mock.calls[0] as [
      string,
      { title: string; body: string; data: Record<string, unknown> },
    ];
    expect(householdId).toBe('h1');
    expect(payload.title).toBe('Answer on your cover request');
    // The whole point of the earlier change, preserved: a parent can triage
    // this from the lock screen. "The nanny declined a pending shift." told
    // them nothing — not who, not when, not which child.
    expect(payload.body).toBe(
      'Ines turned down Mon 3 Aug, 9:00 am–6:00 pm (Ada).'
    );
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.COVER_ASK_DECLINED,
      shiftId: 's1',
      householdId: 'h1',
      localDate: '2026-08-03',
    });
  });

  it('a RECURRING decline still takes the shift_declined leg, still A6-suppressed by an uncovered push', async () => {
    // N9 is scoped to asks. A pattern shift the carer declines is the case A6
    // was written for and it must keep behaving exactly as before.
    const svc = new ShiftCommandService(
      makeShiftRepo(),
      makeCarerMemberRepo(),
      makeQueries({ kind: 'recurring' }),
      makeEventRepo(),
      makeChildren()
    );
    await svc.decline('carer-1', 's1');
    await flushPush();

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [, payload] = notifyHouseholdParents.mock.calls[0] as [
      string,
      { title: string; data: Record<string, unknown> },
    ];
    expect(payload.title).toBe('Shift declined');
    expect(payload.data.type).toBe(PUSH_NOTIFICATION_TYPES.SHIFT_DECLINED);
  });

  it('never pushes the declining carer herself', async () => {
    await makeService().decline('carer-1', 's1');
    await flushPush();

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('push failure never fails the decline', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('push boom');
    });

    const result = await makeService().decline('carer-1', 's1');
    await flushPush();

    expect(result.status).toBe('declined');
  });

  it('still pushes when the day-thread event write failed', async () => {
    // The status write already committed; parents must learn about the gap
    // even if the advisory audit row did not land.
    const eventRepo = makeEventRepo({
      insertMany: mock(async () => {
        throw new Error('db down');
      }),
    });

    await makeService(eventRepo).decline('carer-1', 's1');
    await flushPush();

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });
});

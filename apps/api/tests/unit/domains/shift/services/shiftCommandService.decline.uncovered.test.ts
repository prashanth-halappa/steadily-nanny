/**
 * Decline uncovered-care detection — suppresses SHIFT_DECLINED when the day
 * is genuinely uncovered.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

const DAY_MS = 24 * 60 * 60 * 1000;
const DIGEST_WINDOW_START = new Date(Date.now() + 28 * DAY_MS).toISOString();
const DIGEST_WINDOW_END = new Date(
  Date.now() + 28 * DAY_MS + 3 * 60 * 60 * 1000
).toISOString();

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
let detectUncoveredCareForDate: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

const NOTHING = { inserted: [], pushed: [] };

beforeAll(async () => {
  detectUncoveredCareForDate = mock(async () => NOTHING);
  notifyHouseholdParents = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate,
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
  detectUncoveredCareForDate.mockClear();
  notifyHouseholdParents.mockClear();
  detectUncoveredCareForDate.mockImplementation(async () => NOTHING);
});

function makeService(over: Partial<ShiftWithChildren> = {}) {
  const shift = { ...pendingShift, ...over };
  return new ShiftCommandService(
    {
      declinePending: mock(async (id: string) => ({
        ...shift,
        id,
        status: 'declined',
      })),
    } as never,
    {
      findActiveMembership: mock(async () => ({
        id: 'm2',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
      })),
    } as never,
    { getOwned: mock(async () => shift) } as never,
    { insertMany: mock(async () => []) } as never,
    // The decline push copy names the child, so the service reaches for
    // ChildQueryService. Its constructor DEFAULT is the real one, which goes
    // to the network and never settles under test — leaving the push pending
    // rather than failing loudly. Always inject it here.
    {
      getOwned: mock(async () => ({ id: 'c1', name: 'Ada' })),
      listForHousehold: mock(async () => [{ id: 'c1', name: 'Ada' }]),
    } as never
  );
}

/** The decline push is fire-and-forget (see the service): let it land. */
async function flushPush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

// A6 is about the RECURRING decline: "one fact, one push", suppress the
// generic `shift_declined` when uncovered detection already told the parent
// about the resulting gap. Every test below therefore drives a `recurring`
// shift. The `extra`/`cover` ask leg is N9's and is deliberately NOT
// suppressible — see the last block in this file, and §1.4.
describe('ShiftCommandService.decline — uncovered detection', () => {
  const RECURRING = { kind: 'recurring' } as Partial<ShiftWithChildren>;

  it('calls detection with cause declined', async () => {
    await makeService(RECURRING).decline('carer-1', 's1');
    await flushPush();

    expect(detectUncoveredCareForDate).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        localDate: '2026-08-03',
        cause: 'declined',
        actorId: 'carer-1',
      })
    );
  });

  it('suppresses shift_declined when uncovered windows were pushed', async () => {
    detectUncoveredCareForDate.mockImplementation(async () => ({
      inserted: [
        {
          childId: 'c1',
          commitmentId: 'cm1',
          startsAt: '2026-08-03T09:00:00.000Z',
          endsAt: '2026-08-03T12:00:00.000Z',
        },
      ],
      pushed: [
        {
          childId: 'c1',
          commitmentId: 'cm1',
          startsAt: '2026-08-03T09:00:00.000Z',
          endsAt: '2026-08-03T12:00:00.000Z',
        },
      ],
    }));

    await makeService(RECURRING).decline('carer-1', 's1');

    await flushPush();

    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('still fires shift_declined when a window was inserted but gated to the digest (nobody heard anything otherwise)', async () => {
    detectUncoveredCareForDate.mockImplementation(async () => ({
      inserted: [
        {
          childId: 'c1',
          commitmentId: 'cm1',
          startsAt: DIGEST_WINDOW_START,
          endsAt: DIGEST_WINDOW_END,
        },
      ],
      pushed: [],
    }));

    await makeService(RECURRING).decline('carer-1', 's1');
    await flushPush();

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_DECLINED,
        }),
      })
    );
  });

  it('fires shift_declined when the day is still covered', async () => {
    await makeService(RECURRING).decline('carer-1', 's1');
    await flushPush();

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_DECLINED,
        }),
      })
    );
  });
});

/**
 * N9 — the bug this build would otherwise have created, pinned.
 *
 * Under D-22 a pending ask stops counting as cover, so the uncovered push
 * fires at ASK time. That makes `pushed.length > 0` true by the time the carer
 * answers, and A6's suppression would swallow EVERY cover-ask decline: the
 * parent asks, she says no, and nobody tells them. `cover_ask_declined` is a
 * different fact ("the person you asked has answered", not "this window is
 * uncovered") and is deliberately outside A6's suppression set.
 */
describe('ShiftCommandService.decline — N9 is immune to A6 suppression', () => {
  for (const kind of ['extra', 'cover'] as const) {
    it(`a ${kind} ask still notifies the parent even when the uncovered push already fired`, async () => {
      const window = {
        childId: 'c1',
        commitmentId: 'cm1',
        startsAt: '2026-08-03T09:00:00.000Z',
        endsAt: '2026-08-03T12:00:00.000Z',
      };
      detectUncoveredCareForDate.mockImplementation(async () => ({
        inserted: [window],
        pushed: [window],
      }));

      await makeService({ kind }).decline('carer-1', 's1');
      await flushPush();

      expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
      expect(notifyHouseholdParents).toHaveBeenCalledWith(
        'h1',
        expect.objectContaining({
          data: expect.objectContaining({
            type: PUSH_NOTIFICATION_TYPES.COVER_ASK_DECLINED,
          }),
        })
      );
    });
  }
});

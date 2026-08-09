/**
 * Uncovered-care push + persist — mock.module BEFORE dynamic import so
 * notifyHouseholdParents can be asserted.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  CoveredShiftInput,
  NeedWindowInput,
} from '@steadily-nanny/shared-types/uncoveredCare';
import {
  computeUncovered,
  uncoveredKey,
} from '@steadily-nanny/shared-types/uncoveredCare';
import type { RaiseUncoveredArgs } from '../../../../../src/domains/child/services/uncoveredCareService';

const LONDON = 'Europe/London';
const MONDAY = '2026-08-03'; // Monday in Europe/London (BST)

function needWindow(overrides: Partial<NeedWindowInput> = {}): NeedWindowInput {
  return {
    id: 'cm1',
    childId: 'child1',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
    startTime: '09:00',
    endTime: '12:00',
    startsOn: null,
    endsOn: null,
    exdates: [],
    ...overrides,
  };
}

/** No shifts — the whole need window is uncovered. */
const baseArgs: RaiseUncoveredArgs = {
  householdId: 'h1',
  localDate: MONDAY,
  timezone: LONDON,
  shifts: [],
  needWindows: [needWindow()],
  closures: [],
  cause: 'nothingScheduled',
};

let UncoveredCareService: typeof import('../../../../../src/domains/child/services/uncoveredCareService').UncoveredCareService;
let notifyHouseholdParents: ReturnType<typeof mock>;

const FIXED_NOW = Date.parse('2026-08-01T12:00:00.000Z');
let realDateNow: typeof Date.now;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents,
    notifyUser: mock(() => undefined),
  }));

  ({ UncoveredCareService } = await import(
    '../../../../../src/domains/child/services/uncoveredCareService'
  ));
});

beforeEach(() => {
  notifyHouseholdParents.mockClear();
  realDateNow = Date.now;
  Date.now = () => FIXED_NOW;
});

afterEach(() => {
  Date.now = realDateNow;
});

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listEventKeysForDate: mock(async () => new Set<string>()),
    insertMany: mock(async (rows: unknown[]) => rows),
    ...overrides,
  };
}

describe('UncoveredCareService.raiseUncoveredOnce', () => {
  it('inserts one uncovered_care event per uncovered window with cause in payload', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    const inserted = await svc.raiseUncoveredOnce({
      ...baseArgs,
      cause: 'needsAdded',
      actorId: 'parent-1',
    });

    expect(inserted).toHaveLength(1);
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
    const rows = eventRepo.insertMany.mock.calls[0]?.[0] as {
      event_type: string;
      shift_id: null;
      actor_id: string;
      payload: Record<string, unknown>;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('uncovered_care');
    expect(rows[0]?.shift_id).toBeNull();
    expect(rows[0]?.actor_id).toBe('parent-1');
    expect(rows[0]?.payload.cause).toBe('needsAdded');
    expect(rows[0]?.payload.child_id).toBe('child1');
    expect(rows[0]?.payload.commitment_id).toBe('cm1');
    expect(typeof rows[0]?.payload.starts_at).toBe('string');
    expect(typeof rows[0]?.payload.ends_at).toBe('string');
    expect(typeof rows[0]?.payload.key).toBe('string');
  });

  it('skips keys already present for that date (no insert, no push)', async () => {
    const [window] = computeUncovered({
      localDate: MONDAY,
      timezone: LONDON,
      needWindows: [needWindow()],
      shifts: [],
      closures: [],
    });
    if (!window) {
      throw new Error('expected uncovered window');
    }
    const existingKey = uncoveredKey(window);

    const eventRepo = makeEventRepo({
      listEventKeysForDate: mock(async () => new Set([existingKey])),
    });
    const svc = new UncoveredCareService(eventRepo);

    const inserted = await svc.raiseUncoveredOnce(baseArgs);

    expect(inserted).toHaveLength(0);
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('does not push when insertMany creates nothing (F-B6-5 regression guard)', async () => {
    const eventRepo = makeEventRepo({
      insertMany: mock(async () => []),
    });
    const svc = new UncoveredCareService(eventRepo);

    const inserted = await svc.raiseUncoveredOnce(baseArgs);

    expect(inserted).toHaveLength(0);
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('returns and pushes only windows insertMany reports as created when a batch is partially suppressed', async () => {
    const eventRepo = makeEventRepo({
      insertMany: mock(async (rows: { payload: { commitment_id: string } }[]) =>
        rows.filter(row => row.payload.commitment_id === 'cm2')
      ),
    });
    const svc = new UncoveredCareService(eventRepo);

    const inserted = await svc.raiseUncoveredOnce({
      ...baseArgs,
      needWindows: [needWindow({ id: 'cm1' }), needWindow({ id: 'cm2' })],
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.commitmentId).toBe('cm2');
    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });

  it('still inserts but pushes when every uncovered window starts more than 72h out', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    const inserted = await svc.raiseUncoveredOnce({
      ...baseArgs,
      localDate: '2026-08-06',
    });

    expect(inserted).toHaveLength(1);
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });

  it('pushes with uncovered_care_detected type and localDate when windows are inserted', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    await svc.raiseUncoveredOnce(baseArgs);

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        title: 'No one booked',
        body: 'A time you need your nanny is not on the schedule.',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED,
          householdId: 'h1',
          localDate: MONDAY,
        }),
      }),
      { excludeUserId: undefined }
    );
  });

  it('push failure never fails persistence', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('push boom');
    });
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    const inserted = await svc.raiseUncoveredOnce(baseArgs);

    expect(inserted).toHaveLength(1);
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
  });

  it('returns [] when shifts fully cover the need window', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);
    const coveringShift: CoveredShiftInput = {
      id: 'shift1',
      startsAt: '2026-08-03T07:00:00.000Z',
      endsAt: '2026-08-03T16:00:00.000Z',
      status: 'confirmed',
      children: [{ childId: 'child1', startsAt: null, endsAt: null }],
    };

    const inserted = await svc.raiseUncoveredOnce({
      ...baseArgs,
      shifts: [coveringShift],
    });

    expect(inserted).toHaveLength(0);
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });
});

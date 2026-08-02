import { describe, expect, it, mock } from 'bun:test';
import { SchedulePatternNotFoundError } from '../../../../../src/domains/schedule/errors/scheduleErrors';
import { SchedulePatternQueryService } from '../../../../../src/domains/schedule/services/schedulePatternQueryService';
import type { SchedulePattern } from '../../../../../src/domains/schedule/types';

const pattern: SchedulePattern = {
  id: 'p1',
  household_id: 'h1',
  carer_id: 'carer-1',
  status: 'draft',
  rrule: 'FREQ=WEEKLY;INTERVAL=1',
  dtstart: '2026-02-02',
  until: null,
  exdates: [],
  pause_ranges: [],
  timezone: 'Europe/London',
  note: null,
  decline_message: null,
  created_by: 'u1',
  sent_at: null,
  responded_at: null,
  ical_uid: 'uid-1',
  sequence: 0,
  created_at: 't',
  updated_at: 't',
};

const membership = {
  id: 'm1',
  household_id: 'h1',
  user_id: 'u1',
  role: 'owner',
};

function makePatternRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForHousehold: mock(async () => [pattern]),
    findById: mock(async () => pattern),
    ...overrides,
  };
}

function makeDayRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForPattern: mock(async () => [
      {
        id: 'd1',
        pattern_id: 'p1',
        weekday: 4,
        start_time: '08:00',
        end_time: '17:00',
      },
    ]),
    ...overrides,
  };
}

function makeDayChildRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForDays: mock(async () => [
      {
        id: 'c1',
        pattern_day_id: 'd1',
        child_id: 'child-1',
        start_time: null,
        end_time: null,
        created_at: 't',
      },
    ]),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => membership),
    ...overrides,
  };
}

describe('SchedulePatternQueryService.listForHousehold', () => {
  it('lists patterns once membership is confirmed', async () => {
    const svc = new SchedulePatternQueryService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo()
    );
    expect(await svc.listForHousehold('u1', 'h1')).toEqual([pattern]);
  });

  it('throws for a non-member', async () => {
    const svc = new SchedulePatternQueryService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) })
    );
    await expect(svc.listForHousehold('u2', 'h1')).rejects.toThrow();
  });
});

describe('SchedulePatternQueryService.getOwned', () => {
  it('returns the pattern for an active household member', async () => {
    const svc = new SchedulePatternQueryService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo()
    );
    expect(await svc.getOwned('u1', 'p1')).toEqual(pattern);
  });

  it('throws SchedulePatternNotFoundError for a non-member (no existence leak)', async () => {
    const svc = new SchedulePatternQueryService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) })
    );
    await expect(svc.getOwned('u2', 'p1')).rejects.toBeInstanceOf(
      SchedulePatternNotFoundError
    );
  });

  it('throws the SAME error for a truly missing pattern', async () => {
    const svc = new SchedulePatternQueryService(
      makePatternRepo({ findById: mock(async () => null) }),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo()
    );
    await expect(svc.getOwned('u1', 'missing')).rejects.toBeInstanceOf(
      SchedulePatternNotFoundError
    );
  });
});

describe('SchedulePatternQueryService.getDaysForPattern', () => {
  it('assembles days with children WITHOUT any ownership/membership check', async () => {
    const memberRepo = makeMemberRepo({
      findActiveMembership: mock(async () => {
        throw new Error('should never be called');
      }),
    });
    const svc = new SchedulePatternQueryService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      memberRepo
    );
    const days = await svc.getDaysForPattern('p1');
    expect(days).toHaveLength(1);
    expect(days[0]?.children).toEqual([
      {
        id: 'c1',
        pattern_day_id: 'd1',
        child_id: 'child-1',
        start_time: null,
        end_time: null,
        created_at: 't',
      },
    ]);
  });
});

describe('SchedulePatternQueryService.getWithDays', () => {
  it('assembles the pattern with its days, each carrying its own children', async () => {
    const svc = new SchedulePatternQueryService(
      makePatternRepo(),
      makeDayRepo(),
      makeDayChildRepo(),
      makeMemberRepo()
    );
    const result = await svc.getWithDays('u1', 'p1');
    expect(result.id).toBe('p1');
    expect(result.days).toHaveLength(1);
    expect(result.days[0]?.children).toEqual([
      {
        id: 'c1',
        pattern_day_id: 'd1',
        child_id: 'child-1',
        start_time: null,
        end_time: null,
        created_at: 't',
      },
    ]);
  });
});

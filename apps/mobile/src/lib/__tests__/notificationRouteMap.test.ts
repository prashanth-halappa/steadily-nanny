/**
 * @module lib/__tests__/notificationRouteMap.test
 *
 * Exhaustiveness + resolver contracts for the product push deep-link map.
 * If a new `PUSH_NOTIFICATION_TYPES` value lands without a map entry, this
 * fails — the AppBootstrap map cannot silently rot back to `{}`.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_PUSH_NOTIFICATION_TYPES,
  PUSH_NOTIFICATION_TYPES,
} from '@steadily-nanny/shared-types';
import { NOTIFICATION_ROUTE_MAP } from '../notificationRouteMap';
import type { NotificationRouteMap } from '../pushNotification';

describe('NOTIFICATION_ROUTE_MAP exhaustiveness', () => {
  it('covers every ALL_PUSH_NOTIFICATION_TYPES value', () => {
    for (const type of ALL_PUSH_NOTIFICATION_TYPES) {
      expect(NOTIFICATION_ROUTE_MAP[type]).toBeDefined();
      expect(typeof NOTIFICATION_ROUTE_MAP[type]).toBe('function');
    }
  });

  it('has no extra keys beyond the locked push-type union', () => {
    const known = new Set<string>(ALL_PUSH_NOTIFICATION_TYPES);
    for (const key of Object.keys(NOTIFICATION_ROUTE_MAP)) {
      expect(known.has(key)).toBe(true);
    }
  });
});

describe('NOTIFICATION_ROUTE_MAP resolvers', () => {
  const resolve = (
    type: (typeof ALL_PUSH_NOTIFICATION_TYPES)[number],
    data: Record<string, unknown> = {}
  ): string | null => NOTIFICATION_ROUTE_MAP[type](data);

  it('routes clock_out_reminder to Today (running-entry surface)', () => {
    expect(resolve(PUSH_NOTIFICATION_TYPES.CLOCK_OUT_REMINDER)).toBe(
      '/(private)/(tabs)/home'
    );
  });

  it('routes timesheet pushes to Hours with payload ids', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED, {
        householdId: 'hh-1',
        weekStart: '2026-08-03',
        timesheetId: 'ts-1',
      })
    ).toBe(
      '/(private)/(tabs)/hours?householdId=hh-1&weekStart=2026-08-03&timesheetId=ts-1'
    );
    const queried = resolve(PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERIED, {
      householdId: 'hh-1',
      weekStart: '2026-08-03',
      timesheetId: 'ts-1',
    });
    expect(queried).toContain('/(private)/(tabs)/hours?');
    expect(queried).toContain('timesheetId=ts-1');
  });

  it('routes pattern-sent to the respond screen via patternId', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT, {
        patternId: 'pat-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/respond/pat-1?householdId=hh-1');
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT, {})
    ).toBeNull();
  });

  it('routes pattern-responded to the Schedule tab with patternId', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_RESPONDED, {
        patternId: 'pat-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/(tabs)/schedule?patternId=pat-1&householdId=hh-1');
  });

  it('routes pattern-amended to the shifts calendar', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_AMENDED, {
        patternId: 'pat-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/shifts?patternId=pat-1&householdId=hh-1');
  });

  it('routes shift / change-request pushes to shift detail with ids', () => {
    const shiftTypes = [
      PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED,
      PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED,
      PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_DECLINED,
      PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_WITHDRAWN,
      PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED,
      PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
      PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM,
    ] as const;

    for (const type of shiftTypes) {
      const href = resolve(type, {
        shiftId: 'shift-1',
        changeRequestId: 'cr-1',
        householdId: 'hh-1',
      });
      expect(href).toContain('/(private)/schedule/shifts/shift-1');
      expect(href).toContain('changeRequestId=cr-1');
      expect(href).toContain('householdId=hh-1');
      expect(resolve(type, {})).toBeNull();
    }
  });

  it('routes carer time-off conflict to the shifts calendar for the household', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT, {
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/shifts?householdId=hh-1');
  });

  it('routes pay_terms_set to the nanny My pay screen', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET, {
        householdId: 'hh-1',
      })
    ).toBe('/(private)/settings/my-pay');
  });

  it('is usable as the injected NotificationRouteMap type', () => {
    const map: NotificationRouteMap = NOTIFICATION_ROUTE_MAP;
    expect(Object.keys(map).length).toBe(ALL_PUSH_NOTIFICATION_TYPES.length);
  });
});

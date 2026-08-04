/**
 * @module lib/notificationRouteMap
 *
 * Product push / local-notification → in-app deep-link map. Covers every
 * `ALL_PUSH_NOTIFICATION_TYPES` value; AppBootstrap injects this into
 * `useNotificationObserver`. Payload field names match API emitters
 * (`householdId`, `weekStart`, `timesheetId`, `patternId`, `shiftId`,
 * `changeRequestId`).
 *
 * Orchestrator wiring (one line in AppBootstrap):
 *   import { NOTIFICATION_ROUTE_MAP } from '@/src/lib/notificationRouteMap';
 */

import {
  PUSH_NOTIFICATION_TYPES,
  type PushNotificationType,
} from '@steadily-nanny/shared-types';
import type {
  NotificationRouteMap,
  NotificationRouteResolver,
} from './pushNotification';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function appendQuery(
  path: string,
  params: Record<string, string | null | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 0) {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs.length > 0 ? `${path}?${qs}` : path;
}

const hoursHref: NotificationRouteResolver = data =>
  appendQuery('/(private)/(tabs)/hours', {
    householdId: asString(data.householdId),
    weekStart: asString(data.weekStart),
    timesheetId: asString(data.timesheetId),
  });

const shiftDetailHref: NotificationRouteResolver = data => {
  const shiftId = asString(data.shiftId);
  if (!shiftId) return null;
  return appendQuery(`/(private)/schedule/shifts/${shiftId}`, {
    changeRequestId: asString(data.changeRequestId),
    householdId: asString(data.householdId),
  });
};

const patternRespondHref: NotificationRouteResolver = data => {
  const patternId = asString(data.patternId);
  if (!patternId) return null;
  return appendQuery(`/(private)/schedule/respond/${patternId}`, {
    householdId: asString(data.householdId),
  });
};

const scheduleTabHref: NotificationRouteResolver = data =>
  appendQuery('/(private)/(tabs)/schedule', {
    patternId: asString(data.patternId),
    householdId: asString(data.householdId),
  });

const shiftsCalendarHref: NotificationRouteResolver = data =>
  appendQuery('/(private)/schedule/shifts', {
    patternId: asString(data.patternId),
    householdId: asString(data.householdId),
  });

/**
 * Full product route map. Typed against `PushNotificationType` so a missing
 * key is a compile error; the colocated exhaustiveness test guards runtime.
 */
export const NOTIFICATION_ROUTE_MAP: NotificationRouteMap &
  Record<PushNotificationType, NotificationRouteResolver> = {
  [PUSH_NOTIFICATION_TYPES.CLOCK_OUT_REMINDER]: () => '/(private)/(tabs)/home',

  [PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED]: hoursHref,
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERIED]: hoursHref,

  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT]: patternRespondHref,
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_RESPONDED]: scheduleTabHref,
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_AMENDED]: shiftsCalendarHref,

  [PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_DECLINED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_WITHDRAWN]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM]: shiftDetailHref,

  [PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT]: shiftsCalendarHref,

  // Static destination — the nanny's own read-only pay screen fetches every
  // household she belongs to itself, so no query params are needed here.
  [PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET]: () => '/(private)/settings/my-pay',
};

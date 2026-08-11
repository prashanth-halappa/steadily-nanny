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

const uncoveredCareHref: NotificationRouteResolver = data =>
  appendQuery('/(private)/schedule/shifts', {
    householdId: asString(data.householdId),
    localDate: asString(data.localDate),
    focusUncovered: '1',
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
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_REOPENED]: hoursHref,
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_APPROVED]: hoursHref,
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_AWAITING_APPROVAL]: hoursHref,
  // The week thread (3-T1, §1.3 N3/N4). Both land on the week the
  // conversation is about — `WeekQueryThread` renders there and nowhere
  // else, so there is no separate thread route to send them to.
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_NOTE_ADDED]: hoursHref,
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERY_WITHDRAWN]: hoursHref,

  // Expenses render inside the Hours tab — no dedicated expense route.
  [PUSH_NOTIFICATION_TYPES.EXPENSE_SUBMITTED]: hoursHref,
  [PUSH_NOTIFICATION_TYPES.EXPENSE_APPROVED]: hoursHref,
  [PUSH_NOTIFICATION_TYPES.EXPENSE_REJECTED]: hoursHref,

  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT]: patternRespondHref,
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_RESPONDED]: scheduleTabHref,
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_AMENDED]: shiftsCalendarHref,

  [PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_DECLINED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_EXPIRED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_WITHDRAWN]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.SHIFT_CONFIRMED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.SHIFT_DECLINED]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.SHIFT_REMINDER]: shiftDetailHref,
  // Both carry `shiftId` + `householdId` only — the shift they are about is
  // the whole message, so they land on the same detail screen.
  [PUSH_NOTIFICATION_TYPES.RUNNING_LATE]: shiftDetailHref,
  [PUSH_NOTIFICATION_TYPES.PARENT_COVERING]: shiftDetailHref,
  // 3-N (A2, N7): same fact-shape as SHIFT_REMINDER — carries `shiftId` +
  // `householdId` only, same destination.
  [PUSH_NOTIFICATION_TYPES.COVER_ASK_REMINDER]: shiftDetailHref,

  [PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT]: shiftsCalendarHref,
  // 3-T3 (§1.3 N10): a sick day is a fact about the SET of shifts it hit, not
  // about any one of them — the calendar is the only surface showing the set.
  [PUSH_NOTIFICATION_TYPES.CARER_SICK_SHIFTS_AFFECTED]: shiftsCalendarHref,
  [PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED]: uncoveredCareHref,
  // Evening digest carries the same householdId + earliest-affected-date
  // payload shape as the immediate alert, so it reuses the resolver.
  [PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DIGEST]: uncoveredCareHref,
  // 3-T3 (§1.3 N8/N9): an ask that expired or was declined hands the window
  // back to the parent uncovered — the same fact the uncovered alert carries,
  // so the same destination. Not shift detail: the shift is over as a
  // question, and what she needs is the gap and its actions (§2.4a).
  [PUSH_NOTIFICATION_TYPES.COVER_ASK_EXPIRED]: uncoveredCareHref,
  [PUSH_NOTIFICATION_TYPES.COVER_ASK_DECLINED]: uncoveredCareHref,

  [PUSH_NOTIFICATION_TYPES.HOUSEHOLD_CLOSURE_CHANGED]: scheduleTabHref,

  // Static destination — the nanny's own read-only pay screen fetches every
  // household she belongs to itself, so no query params are needed here.
  [PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET]: () => '/(private)/settings/my-pay',

  // A carer cancelled time off a parent had already marked paid;
  // `ptoCommandService.reconcileCancelledTimeOff` notifies that household's
  // parents so they see the corrected balance — same static-destination
  // shape as PAY_TERMS_SET, since the recipient is household-scoped, not
  // per-time-off.
  [PUSH_NOTIFICATION_TYPES.PTO_USAGE_REVERSED]: () =>
    '/(private)/settings/household-time-off',

  [PUSH_NOTIFICATION_TYPES.PTO_MARKED_PAID]: () => '/(private)/settings/my-pay',

  // A parent recorded a settlement — land the carer on the week it settles,
  // same Hours destination (and payload fields) as the timesheet leg.
  [PUSH_NOTIFICATION_TYPES.PAYMENT_RECORDED]: hoursHref,
  // 3-T2 (§1.3 N5/N6): a corrected payment and a settled reimbursement are
  // both facts about one week's money — same Hours destination and payload
  // fields as the settlement they amend.
  [PUSH_NOTIFICATION_TYPES.PAYMENT_CORRECTED]: hoursHref,
  [PUSH_NOTIFICATION_TYPES.REIMBURSEMENT_SETTLED]: hoursHref,

  [PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED]: () =>
    '/(private)/settings/household-time-off',

  [PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED]: () =>
    '/(private)/settings/household',

  [PUSH_NOTIFICATION_TYPES.CO_PARENT_ACTION_FYI]: shiftDetailHref,

  // Handoff notes render inside Today — no dedicated handoff route.
  [PUSH_NOTIFICATION_TYPES.HANDOFF_NOTE_ADDED]: () => '/(private)/(tabs)/home',

  // Today, not shift detail: the parent's question is "is anyone with my
  // kids right now", which NannyLiveStatusCard answers. Shift detail would
  // show them the schedule they already know.
  [PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW]: () => '/(private)/(tabs)/home',

  // 3-N (A1/D-26, N11): unlike the immediate alert, the morning catch-up is
  // never about "right now" — the window is long past by the time it fires.
  // Matrix routes it to the shifts calendar, same surface as the other
  // schedule-review pushes.
  [PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW_DIGEST]: shiftsCalendarHref,
};

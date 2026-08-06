/**
 * @module domains/schedule/utils/calendarSyncNative
 *
 * Default deps that talk to expo-calendar + the live API. This is the only
 * calendar-sync module that imports `expo-calendar`.
 */
import * as Sentry from '@sentry/react-native';
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
// ponytail: expo-calendar/legacy is deprecated in SDK 57; migrate to root class API when EventKit write+read path is reworked.
import * as Calendar from 'expo-calendar/legacy';
import { childrenApi } from '@/src/api/endpoints/children';
import { householdApi } from '@/src/api/endpoints/household';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { userApi } from '@/src/api/endpoints/user';
import i18n from '@/src/i18n';
import { useAuthStore } from '@/src/store/auth';
import { useCalendarSyncStore } from '@/src/store/calendarSyncStore';
import type { CalendarEventLabels } from './calendarSync';
import type { MemberDisplayLabels } from './memberDisplayName';
import {
  type CalendarSyncDeps,
  type ClearMarkedEventsDeps,
  clearMarkedEvents,
  runCalendarSync,
} from './runCalendarSync';

function resolveEventLabels(): CalendarEventLabels {
  return {
    childcare: i18n.t('schedule:calendarSync.childcare'),
    pendingConfirmation: i18n.t('schedule:calendarSync.pendingConfirmation'),
  };
}

function resolveMemberDisplayLabels(): MemberDisplayLabels {
  return {
    you: i18n.t('schedule:detail.you'),
    someone: i18n.t('schedule:detail.someone'),
    // Prefer the warmer "Your nanny" for carers on calendar titles.
    roleFallback: (role: HouseholdMember['role']) => {
      if (role === 'nanny' || role === 'helper') {
        return i18n.t('schedule:build.carerFallbackName');
      }
      return i18n.t(`schedule:detail.roleFallback.${role}`);
    },
  };
}

export function createDefaultCalendarSyncDeps(): CalendarSyncDeps {
  return {
    getPreferences: () => {
      const state = useCalendarSyncStore.getState();
      return { enabled: state.enabled, calendarId: state.calendarId };
    },
    getMyUserId: () => useAuthStore.getState().session?.user?.id ?? null,
    listHouseholds: () => householdApi.list(),
    listMemberships: () => userApi.listMemberships(),
    listShifts: (householdId, from, to) =>
      shiftApi.range(householdId, from, to),
    listChildren: householdId => childrenApi.list(householdId),
    listMembers: householdId => householdApi.listMembers(householdId),
    getPermissions: async () => {
      const result = await Calendar.getCalendarPermissionsAsync();
      return { granted: result.granted, status: result.status };
    },
    getEvents: async (calendarId, from, to) => {
      const events = await Calendar.getEventsAsync([calendarId], from, to);
      return events.map(event => ({
        id: event.id,
        title: event.title,
        notes: event.notes,
        startDate: event.startDate,
        endDate: event.endDate,
      }));
    },
    createEvent: (calendarId, details) =>
      Calendar.createEventAsync(calendarId, details),
    updateEvent: async (eventId, details) => {
      await Calendar.updateEventAsync(eventId, details);
    },
    deleteEvent: async eventId => {
      await Calendar.deleteEventAsync(eventId);
    },
    captureException: (error, context) => {
      Sentry.captureException(error, context);
    },
    getEventLabels: resolveEventLabels,
    getMemberDisplayLabels: resolveMemberDisplayLabels,
  };
}

export function createDefaultClearMarkedEventsDeps(
  calendarId: string
): ClearMarkedEventsDeps {
  const full = createDefaultCalendarSyncDeps();
  return {
    calendarId,
    getPermissions: full.getPermissions,
    getEvents: full.getEvents,
    deleteEvent: full.deleteEvent,
    captureException: full.captureException,
  };
}

/** Production entry: run sync with live native + API deps. */
export async function runDefaultCalendarSync(): Promise<void> {
  await runCalendarSync(createDefaultCalendarSyncDeps());
}

/** Production entry: wipe Steadily-marked events before disconnect. */
export async function clearMarkedEventsDefault(
  calendarId: string
): Promise<void> {
  await clearMarkedEvents(createDefaultClearMarkedEventsDeps(calendarId));
}

export async function requestCalendarPermissions(): Promise<{
  granted: boolean;
  status: string;
}> {
  const result = await Calendar.requestCalendarPermissionsAsync();
  return { granted: result.granted, status: result.status };
}

export async function getCalendarPermissions(): Promise<{
  granted: boolean;
  status: string;
}> {
  const result = await Calendar.getCalendarPermissionsAsync();
  return { granted: result.granted, status: result.status };
}

export type WritableCalendar = {
  id: string;
  title: string;
  sourceName: string;
  sourceType: string;
  isLocal: boolean;
  allowsModifications: boolean;
};

/**
 * Turns sync on against the first writable calendar found, without the
 * manual picker `TimeSettingsScreen.handleToggle` offers — used by the
 * onboarding calendar step, where asking someone to pick among calendars
 * before they've seen the feature work is a step too many. Settings lets
 * them switch to a different calendar afterward. Assumes permission is
 * already granted (call after `requestCalendarPermissions()` succeeds).
 */
export async function enableDefaultCalendarSync(): Promise<boolean> {
  const calendars = await listWritableCalendars();
  const first = calendars[0];
  if (!first) return false;
  useCalendarSyncStore
    .getState()
    .setCalendar(first.id, `${first.sourceName} · ${first.title}`);
  useCalendarSyncStore.getState().setEnabled(true);
  void runDefaultCalendarSync();
  return true;
}

export async function listWritableCalendars(): Promise<WritableCalendar[]> {
  const calendars = await Calendar.getCalendarsAsync(
    Calendar.EntityTypes.EVENT
  );
  return calendars
    .filter(cal => cal.allowsModifications)
    .map(cal => {
      const sourceType = String(cal.source?.type ?? '');
      const isLocal =
        cal.source?.isLocalAccount === true ||
        sourceType.toLowerCase() === 'local' ||
        sourceType === Calendar.CalendarType.LOCAL ||
        sourceType === Calendar.SourceType.LOCAL;
      return {
        id: cal.id,
        title: cal.title,
        sourceName: cal.source?.name ?? 'Calendar',
        sourceType,
        isLocal,
        allowsModifications: cal.allowsModifications,
      };
    });
}

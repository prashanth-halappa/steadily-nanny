/**
 * @module domains/schedule/utils/runCalendarSync
 *
 * Sync orchestration with injectable deps. Pure of expo-calendar — the
 * native binding lives in `calendarSyncNative.ts` so unit tests never load it.
 */
import { MATERIALISATION_HORIZON_DAYS } from '@steadily-nanny/shared-types';
import type { Child } from '@steadily-nanny/shared-types/schemas/child.schema';
import type {
  Household,
  HouseholdMember,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  type CalendarEventLabels,
  DEFAULT_CALENDAR_EVENT_LABELS,
  type DesiredEvent,
  diffCalendarEvents,
  type ExistingDeviceEvent,
  isSyncableStatus,
  parseMarker,
  renderEvent,
  type SyncRole,
} from './calendarSync';
import {
  type MemberDisplayLabels,
  resolveMemberDisplayName,
} from './memberDisplayName';

/** Same horizon the API materialises — shared-types source of truth. */
export const SYNC_HORIZON_DAYS = MATERIALISATION_HORIZON_DAYS;

/** How far back disconnect/clear looks for stranded Steadily events. */
export const CLEAR_LOOKBACK_DAYS = 365;

export interface DeviceCalendarEvent {
  id: string;
  title: string;
  notes: string | null | undefined;
  startDate: string | Date;
  endDate: string | Date;
}

export interface CalendarPermissionSnapshot {
  granted: boolean;
  status: string;
}

export interface CalendarSyncDeps {
  getPreferences: () => { enabled: boolean; calendarId: string | null };
  getMyUserId: () => string | null;
  listHouseholds: () => Promise<Household[]>;
  listMemberships: () => Promise<HouseholdMember[]>;
  listShifts: (
    householdId: string,
    from: string,
    to: string
  ) => Promise<Shift[]>;
  listChildren: (householdId: string) => Promise<Child[]>;
  listMembers: (householdId: string) => Promise<HouseholdMember[]>;
  getPermissions: () => Promise<CalendarPermissionSnapshot>;
  getEvents: (
    calendarId: string,
    from: Date,
    to: Date
  ) => Promise<DeviceCalendarEvent[]>;
  createEvent: (
    calendarId: string,
    details: {
      title: string;
      notes: string;
      startDate: Date;
      endDate: Date;
    }
  ) => Promise<string>;
  updateEvent: (
    eventId: string,
    details: {
      title: string;
      notes: string;
      startDate: Date;
      endDate: Date;
    }
  ) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  getEventLabels?: () => CalendarEventLabels;
  getMemberDisplayLabels?: () => MemberDisplayLabels;
  now?: () => Date;
}

export interface ClearMarkedEventsDeps {
  calendarId: string;
  getPermissions: () => Promise<CalendarPermissionSnapshot>;
  getEvents: (
    calendarId: string,
    from: Date,
    to: Date
  ) => Promise<DeviceCalendarEvent[]>;
  deleteEvent: (eventId: string) => Promise<void>;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  now?: () => Date;
}

const DEFAULT_MEMBER_LABELS: MemberDisplayLabels = {
  you: 'You',
  someone: 'Someone',
  roleFallback: role => {
    if (role === 'nanny') return 'A nanny';
    if (role === 'helper') return 'A helper';
    return 'A parent';
  },
};

function syncRoleForMembership(
  role: HouseholdMember['role'] | undefined
): SyncRole {
  if (role === 'nanny' || role === 'helper') return 'nanny';
  return 'parent';
}

function isCarerRole(role: HouseholdMember['role'] | undefined): boolean {
  return role === 'nanny' || role === 'helper';
}

function windowBounds(now: Date): { from: Date; to: Date } {
  const from = now;
  const to = new Date(now.getTime() + SYNC_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}

function clearWindowBounds(now: Date): { from: Date; to: Date } {
  const from = new Date(
    now.getTime() - CLEAR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  );
  const to = new Date(now.getTime() + SYNC_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}

function toExisting(events: DeviceCalendarEvent[]): ExistingDeviceEvent[] {
  const result: ExistingDeviceEvent[] = [];
  for (const event of events) {
    const icalUid = parseMarker(event.notes);
    if (!icalUid) continue;
    result.push({
      id: event.id,
      icalUid,
      title: event.title,
      notes: event.notes ?? '',
      startMs: new Date(event.startDate).getTime(),
      endMs: new Date(event.endDate).getTime(),
    });
  }
  return result;
}

function childNamesForShift(shift: Shift, children: Child[]): string[] {
  const byId = new Map(children.map(child => [child.id, child.name]));
  const names: string[] = [];
  for (const link of shift.shift_children ?? []) {
    const name = byId.get(link.child_id);
    if (name) names.push(name);
  }
  return names;
}

async function applyDiff(
  calendarId: string,
  desired: DesiredEvent[],
  existing: ExistingDeviceEvent[],
  deps: Pick<CalendarSyncDeps, 'createEvent' | 'updateEvent' | 'deleteEvent'>
): Promise<void> {
  const { create, update, deleteIds } = diffCalendarEvents(desired, existing);

  for (const event of create) {
    await deps.createEvent(calendarId, {
      title: event.title,
      notes: event.notes,
      startDate: new Date(event.startMs),
      endDate: new Date(event.endMs),
    });
  }
  for (const item of update) {
    await deps.updateEvent(item.id, {
      title: item.event.title,
      notes: item.event.notes,
      startDate: new Date(item.event.startMs),
      endDate: new Date(item.event.endMs),
    });
  }
  for (const id of deleteIds) {
    await deps.deleteEvent(id);
  }
}

export async function runCalendarSync(deps: CalendarSyncDeps): Promise<void> {
  try {
    const prefs = deps.getPreferences();
    if (!prefs.enabled || !prefs.calendarId) return;

    const permission = await deps.getPermissions();
    if (!permission.granted) return;

    const myUserId = deps.getMyUserId();
    if (!myUserId) return;

    const now = (deps.now ?? (() => new Date()))();
    const { from, to } = windowBounds(now);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const eventLabels =
      deps.getEventLabels?.() ?? DEFAULT_CALENDAR_EVENT_LABELS;
    const memberLabels =
      deps.getMemberDisplayLabels?.() ?? DEFAULT_MEMBER_LABELS;

    const [households, memberships] = await Promise.all([
      deps.listHouseholds(),
      deps.listMemberships(),
    ]);
    const membershipByHousehold = new Map(
      memberships.map(m => [m.household_id, m])
    );

    const desired: DesiredEvent[] = [];

    for (const household of households) {
      const membership = membershipByHousehold.get(household.id);
      const role = syncRoleForMembership(membership?.role);
      const carerOnly = isCarerRole(membership?.role);

      const [shifts, children, members] = await Promise.all([
        deps.listShifts(household.id, fromIso, toIso),
        deps.listChildren(household.id),
        deps.listMembers(household.id),
      ]);

      const membersByUserId = new Map(
        members.map(member => [member.user_id, member])
      );

      for (const shift of shifts) {
        if (!isSyncableStatus(shift.status)) continue;
        if (carerOnly && shift.carer_id !== myUserId) continue;

        const carerName = resolveMemberDisplayName(
          shift.carer_id,
          myUserId,
          membersByUserId,
          memberLabels
        );

        desired.push(
          renderEvent({
            icalUid: shift.ical_uid,
            status: shift.status,
            startsAt: shift.starts_at,
            endsAt: shift.ends_at,
            childNames: childNamesForShift(shift, children),
            householdName: household.name,
            carerName: carerName === memberLabels.someone ? null : carerName,
            role,
            labels: eventLabels,
          })
        );
      }
    }

    const deviceEvents = await deps.getEvents(prefs.calendarId, from, to);
    await applyDiff(prefs.calendarId, desired, toExisting(deviceEvents), deps);
  } catch (error) {
    deps.captureException(error, { tags: { flow: 'calendar-sync' } });
  }
}

export async function clearMarkedEvents(
  deps: ClearMarkedEventsDeps
): Promise<void> {
  try {
    const permission = await deps.getPermissions();
    if (!permission.granted) return;

    const now = (deps.now ?? (() => new Date()))();
    const { from, to } = clearWindowBounds(now);
    const events = await deps.getEvents(deps.calendarId, from, to);
    for (const event of events) {
      if (!parseMarker(event.notes)) continue;
      await deps.deleteEvent(event.id);
    }
  } catch (error) {
    deps.captureException(error, {
      tags: { flow: 'calendar-sync-clear' },
    });
  }
}

/**
 * @module lib/useWidgetSnapshotSync
 *
 * The one wiring point between the app's query cache and the home-screen
 * widgets. Mounted once, headless, next to the other startup syncs in
 * `AppBootstrap`.
 *
 * It reads through the ordinary query hooks rather than subscribing to the
 * QueryCache directly: TanStack already dedupes these against the screens that
 * mount them, `refetchOnWindowFocus: true` (wired to AppState in
 * `src/lib/network.ts`) already re-runs them on foreground, and an effect over
 * `data` already fires exactly when something settles. A bespoke cache
 * subscription would re-implement all three and drift from them.
 *
 * Role decides what gets written: a nanny feeds NextShift + NannyWeek, a
 * parent feeds TodaysCover + ParentWeek. Neither ever feeds the other
 * persona's widget with DATA — instead it gets a redirect payload (root prop
 * absent, `fallbackTitle`/`fallbackBody` set), because iOS shows all four in
 * the gallery to everyone and a permanently blank card looks broken.
 */

import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { COVERING_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { useEffect } from 'react';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { canViewParentSchedule, SETUP_ROLES } from '@/src/domains/setup/types';
import { carerKeyOf } from '@/src/domains/timesheet/utils/carerKey';
import {
  DEFAULT_WEEK_STARTS_ON,
  getWeekStartISO,
} from '@/src/domains/timesheet/utils/week';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useDayThread } from '@/src/hooks/queries/useDayThread';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useMeShifts } from '@/src/hooks/queries/useMeShifts';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import i18n from '@/src/i18n';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import {
  applyWidgetSnapshots,
  buildNannyWeekPayload,
  buildNextShiftPayload,
  buildParentWeekPayload,
  buildRedirectPayload,
  buildTodaysCoverPayload,
  type CoverShiftInput,
  type NannyShiftInput,
} from './widgetSnapshot';
import type { WidgetSnapshotSet } from './widgetSnapshot.types';

/** How far ahead the nanny widget looks. The plan's "next two weeks" empty copy. */
const COVERING_STATUS_SET = new Set<string>(COVERING_SHIFT_STATUSES);
const LOOK_AHEAD_DAYS = 14;

/**
 * First names only — a widget has no room for "Mia Patel-Fernandez", and the
 * lock-screen families drop the line entirely anyway.
 */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

export function useWidgetSnapshotSync(): void {
  const onboarding = useIsOnboarded();
  const currentUserId = useAuthStore(state => state.user?.id ?? null);
  const active = useActiveHousehold();
  const householdsQuery = useHouseholds();

  const timeZone = active.household?.timezone ?? 'UTC';
  const weekStartsOn =
    active.household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON;
  const householdId = active.householdId;
  const householdName = active.household?.name ?? '';

  const isNanny = onboarding.role === SETUP_ROLES.NANNY;
  const isParent = canViewParentSchedule(onboarding.role);

  const today = localDateInZone(timeZone);
  const weekStart = getWeekStartISO(new Date(), timeZone, weekStartsOn);
  const dayFrom = wallClockToUtcIso(today, '00:00', timeZone);
  const dayTo = wallClockToUtcIso(addLocalDays(today, 1), '00:00', timeZone);
  const aheadTo = wallClockToUtcIso(
    addLocalDays(today, LOOK_AHEAD_DAYS),
    '00:00',
    timeZone
  );

  const running = useRunningTimeEntry();
  const weekEntries = useWeekTimeEntries(householdId, weekStart);
  const weekTimesheets = useWeekTimesheet(householdId, weekStart);
  const children = useChildren(householdId);
  // Nanny-only: her shifts across every household she works in.
  const myShifts = useMeShifts(
    isNanny ? dayFrom : undefined,
    isNanny ? aheadTo : undefined
  );
  // Parent-only: today's household shifts, members for names, gaps from the thread.
  const todayShifts = useShiftsRange(
    isParent ? householdId : null,
    dayFrom,
    dayTo
  );
  const members = useHouseholdMembers(isParent ? householdId : null);
  const dayThread = useDayThread(isParent ? householdId : null, today);

  const runningEntry = running.data ?? null;
  const entries = weekEntries.data;
  const timesheets = weekTimesheets.data;
  const childList = children.data;
  const myShiftList = myShifts.data;
  const todayShiftList = todayShifts.data;
  const memberList = members.data;
  const threadEvents = dayThread.data;
  const householdList = householdsQuery.data;
  const language = i18n.language;

  useEffect(() => {
    if (onboarding.status !== 'onboarded') return;
    // Every string in a payload is localized at build time, so switching the
    // app language has to rewrite all four widgets — a real dependency, not a
    // decorative one. Nothing can be built before i18n has resolved a language.
    if (!language) return;

    const nowMs = Date.now();
    const childNameById = new Map(
      (childList ?? []).map(child => [child.id, firstName(child.name)])
    );
    const childNamesFor = (shift: Pick<Shift, 'shift_children'>): string[] =>
      // `shift_children` is only present when the route joined it — an
      // un-joined shift silently yields no children line, which is the line
      // the design drops first anyway.
      (shift.shift_children ?? [])
        .map(link => childNameById.get(link.child_id) ?? '')
        .filter(name => name.length > 0);

    const set: WidgetSnapshotSet = {};

    if (isNanny) {
      const householdNameById = new Map(
        (householdList ?? []).map(household => [household.id, household.name])
      );
      const shifts: NannyShiftInput[] = (myShiftList ?? [])
        .filter(shift => COVERING_STATUS_SET.has(shift.status))
        .map(shift => ({
          id: shift.id,
          startsAt: shift.starts_at,
          endsAt: shift.ends_at,
          householdName:
            householdNameById.get(shift.household_id) ?? householdName,
          timeZone: shift.timezone,
          childNames: childNamesFor(shift),
          needsResponse:
            shift.status === 'pending' && shift.carer_id === currentUserId,
        }));

      set.nextShift = buildNextShiftPayload({
        nowMs,
        timeZone,
        // The queries have resolved at least once — otherwise the widget must
        // keep saying "Open Steadily to get started" rather than "no shifts".
        synced: myShifts.isSuccess || myShifts.isError,
        running: runningEntry?.clock_in_at
          ? {
              clockInAt: runningEntry.clock_in_at,
              householdName:
                householdNameById.get(runningEntry.household_id) ??
                householdName,
              timeZone: runningEntry.timezone,
            }
          : null,
        shifts,
      });

      const mine = (entries ?? []).filter(
        entry => currentUserId !== null && entry.carer_id === currentUserId
      );
      const myKey = mine[0] ? carerKeyOf(mine[0]) : null;
      set.nannyWeek = buildNannyWeekPayload({
        nowMs,
        timeZone,
        householdName,
        entries: mine,
        timesheet:
          (timesheets ?? []).find(
            sheet => myKey !== null && carerKeyOf(sheet) === myKey
          ) ?? null,
      });

      // iOS shows every widget to every user, so she can add a parent one.
      // Say what it is instead of leaving her a card that never fills in.
      set.todaysCover = buildRedirectPayload({
        nowMs,
        timeZone,
        role: 'parent',
      });
      set.parentWeek = buildRedirectPayload({
        nowMs,
        timeZone,
        role: 'parent',
      });
    }

    if (isParent) {
      const membersByUserId = new Map(
        (memberList ?? []).map(member => [member.user_id, member])
      );
      const namesByCarerId: Record<string, string> = {};
      for (const member of memberList ?? []) {
        namesByCarerId[member.user_id] = resolveCarerName(
          membersByUserId.get(member.user_id),
          '',
          null
        );
      }

      const coverShifts: CoverShiftInput[] = (todayShiftList ?? []).map(
        shift => ({
          id: shift.id,
          carerId: shift.carer_id,
          startsAt: shift.starts_at,
          endsAt: shift.ends_at,
          localDate: shift.local_date,
          status: shift.status,
          kind: shift.kind,
          childNames: childNamesFor(shift),
        })
      );

      const gaps = (threadEvents ?? [])
        .filter(event => event.event_type === 'uncovered_care')
        .flatMap(event => {
          const startsAt = event.payload.starts_at;
          const endsAt = event.payload.ends_at;
          return typeof startsAt === 'string' && typeof endsAt === 'string'
            ? [{ startsAt, endsAt }]
            : [];
        });

      set.todaysCover = buildTodaysCoverPayload({
        nowMs,
        timeZone,
        householdName,
        entries: entries ?? [],
        shifts: coverShifts,
        namesByCarerId,
        gaps,
      });

      // The household's whole week — the parent surface is not per-carer.
      set.parentWeek = buildParentWeekPayload({
        nowMs,
        timeZone,
        householdName,
        entries: entries ?? [],
        timesheet: (timesheets ?? [])[0] ?? null,
      });

      set.nextShift = buildRedirectPayload({ nowMs, timeZone, role: 'nanny' });
      set.nannyWeek = buildRedirectPayload({ nowMs, timeZone, role: 'nanny' });
    }

    applyWidgetSnapshots(set);
  }, [
    onboarding.status,
    isNanny,
    isParent,
    currentUserId,
    timeZone,
    householdName,
    runningEntry,
    entries,
    timesheets,
    childList,
    myShiftList,
    myShifts.isSuccess,
    myShifts.isError,
    todayShiftList,
    memberList,
    threadEvents,
    householdList,
  ]);
}

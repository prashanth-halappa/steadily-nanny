/**
 * @module store/calendarViewStore
 *
 * MMKV-persisted preferred calendar view per role (Wave E). Parents and
 * nannies can each remember a different default among the 2a–2d views.
 */
import { createPersistedStore } from './createPersistedStore';

export const CALENDAR_VIEWS = {
  AGENDA: 'agenda',
  WEEK_RIBBON: 'week_ribbon',
  COVERAGE_LANES: 'coverage_lanes',
  CROSS_FAMILY: 'cross_family',
} as const;

export type CalendarViewId =
  (typeof CALENDAR_VIEWS)[keyof typeof CALENDAR_VIEWS];

export type CalendarRole = 'parent' | 'nanny';

export interface CalendarViewState {
  parentView: CalendarViewId;
  nannyView: CalendarViewId;
  setView: (role: CalendarRole, view: CalendarViewId) => void;
  reset: () => void;
}

export const useCalendarViewStore = createPersistedStore<CalendarViewState>(
  set => ({
    parentView: CALENDAR_VIEWS.AGENDA,
    nannyView: CALENDAR_VIEWS.AGENDA,

    setView: (role, view) =>
      set(role === 'parent' ? { parentView: view } : { nannyView: view }),

    reset: () =>
      set({
        parentView: CALENDAR_VIEWS.AGENDA,
        nannyView: CALENDAR_VIEWS.AGENDA,
      }),
  }),
  {
    name: 'calendar-view-storage',
    version: 1,
    partialize: state => ({
      parentView: state.parentView,
      nannyView: state.nannyView,
    }),
  }
);

/** Resolve the stored view for a role, falling back to agenda.
 * Coverage lanes were folded into agenda (Daylight UX #33) — remap. */
export function resolveCalendarView(
  role: CalendarRole,
  stored: CalendarViewState
): CalendarViewId {
  const view = role === 'parent' ? stored.parentView : stored.nannyView;
  if (view === CALENDAR_VIEWS.COVERAGE_LANES) return CALENDAR_VIEWS.AGENDA;
  const valid = Object.values(CALENDAR_VIEWS) as string[];
  return valid.includes(view) ? view : CALENDAR_VIEWS.AGENDA;
}

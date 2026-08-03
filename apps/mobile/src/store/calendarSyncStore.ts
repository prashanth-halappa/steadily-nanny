/**
 * @module store/calendarSyncStore
 *
 * MMKV-persisted preference for one-way device calendar sync. Calendar ids
 * are device-local — meaningless on another phone — so this stays off the
 * server by design.
 */
import { createPersistedStore } from './createPersistedStore';

export interface CalendarSyncState {
  enabled: boolean;
  calendarId: string | null;
  /** Display label for the chosen calendar (e.g. "Google · Family"). */
  calendarLabel: string | null;
  setEnabled: (enabled: boolean) => void;
  setCalendar: (calendarId: string, calendarLabel: string) => void;
  /** Disconnect: turn off and clear the chosen calendar. */
  disconnect: () => void;
  reset: () => void;
}

export const useCalendarSyncStore = createPersistedStore<CalendarSyncState>(
  set => ({
    enabled: false,
    calendarId: null,
    calendarLabel: null,

    setEnabled: enabled => set({ enabled }),

    setCalendar: (calendarId, calendarLabel) =>
      set({ calendarId, calendarLabel }),

    disconnect: () =>
      set({ enabled: false, calendarId: null, calendarLabel: null }),

    reset: () => set({ enabled: false, calendarId: null, calendarLabel: null }),
  }),
  {
    name: 'calendar-sync-storage',
    version: 1,
    partialize: state => ({
      enabled: state.enabled,
      calendarId: state.calendarId,
      calendarLabel: state.calendarLabel,
    }),
  }
);

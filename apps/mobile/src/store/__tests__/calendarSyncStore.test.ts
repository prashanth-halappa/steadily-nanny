/**
 * @module store/__tests__/calendarSyncStore.test
 *
 * Device-local calendar sync preference (enabled + chosen calendar).
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { useCalendarSyncStore } from '../calendarSyncStore';

beforeEach(() => {
  useCalendarSyncStore.getState().reset();
});

describe('useCalendarSyncStore', () => {
  it('defaults to disabled with no calendar chosen', () => {
    const state = useCalendarSyncStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.calendarId).toBeNull();
    expect(state.calendarLabel).toBeNull();
  });

  it('setEnabled flips the toggle flag', () => {
    useCalendarSyncStore.getState().setEnabled(true);
    expect(useCalendarSyncStore.getState().enabled).toBe(true);
    useCalendarSyncStore.getState().setEnabled(false);
    expect(useCalendarSyncStore.getState().enabled).toBe(false);
  });

  it('setCalendar stores id and label', () => {
    useCalendarSyncStore.getState().setCalendar('cal-1', 'Google · Family');
    const state = useCalendarSyncStore.getState();
    expect(state.calendarId).toBe('cal-1');
    expect(state.calendarLabel).toBe('Google · Family');
  });

  it('disconnect clears enabled and calendar fields', () => {
    useCalendarSyncStore.getState().setEnabled(true);
    useCalendarSyncStore.getState().setCalendar('cal-1', 'Google · Family');
    useCalendarSyncStore.getState().disconnect();
    const state = useCalendarSyncStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.calendarId).toBeNull();
    expect(state.calendarLabel).toBeNull();
  });

  it('reset restores defaults after partial mutation', () => {
    useCalendarSyncStore.getState().setEnabled(true);
    useCalendarSyncStore.getState().setCalendar('cal-9', 'iCloud');
    useCalendarSyncStore.getState().reset();
    const state = useCalendarSyncStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.calendarId).toBeNull();
    expect(state.calendarLabel).toBeNull();
  });
});

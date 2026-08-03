/**
 * @module domains/settings/__tests__/CalendarPickerSheet.test
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';

const listWritableCalendars = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/domains/schedule/utils/calendarSyncNative', () => ({
  listWritableCalendars,
}));

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: () =>
      React.createElement('View', { testID: 'loading-indicator-container' }),
  };
});

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));

let CalendarPickerSheet: typeof import('../components/CalendarPickerSheet').CalendarPickerSheet;

beforeAll(async () => {
  const mod = await import('../components/CalendarPickerSheet');
  CalendarPickerSheet = mod.CalendarPickerSheet;
});

beforeEach(() => {
  listWritableCalendars.mockClear();
  listWritableCalendars.mockResolvedValue([]);
});

describe('CalendarPickerSheet', () => {
  it('shows the honest empty state when only local calendars exist', async () => {
    listWritableCalendars.mockResolvedValue([
      {
        id: 'local-1',
        title: 'Calendar',
        sourceName: 'On My iPhone',
        sourceType: 'local',
        isLocal: true,
        allowsModifications: true,
      },
    ]);

    const onSelect = mock(() => {});
    const { getByTestId } = renderWithProviders(
      <CalendarPickerSheet
        visible
        onDismiss={() => {}}
        selectedCalendarId={null}
        onSelect={onSelect}
      />
    );

    await waitFor(() => {
      expect(getByTestId('calendar-picker-empty')).toBeTruthy();
    });
  });

  it('lists Google calendars grouped by source', async () => {
    listWritableCalendars.mockResolvedValue([
      {
        id: 'g-1',
        title: 'Family',
        sourceName: 'Google',
        sourceType: 'com.google',
        isLocal: false,
        allowsModifications: true,
      },
    ]);

    const onSelect = mock(() => {});
    const { getByTestId } = renderWithProviders(
      <CalendarPickerSheet
        visible
        onDismiss={() => {}}
        selectedCalendarId={null}
        onSelect={onSelect}
      />
    );

    await waitFor(() => {
      expect(getByTestId('calendar-option-g-1')).toBeTruthy();
    });
    fireEvent.press(getByTestId('calendar-option-g-1'));
    expect(onSelect).toHaveBeenCalled();
  });
});

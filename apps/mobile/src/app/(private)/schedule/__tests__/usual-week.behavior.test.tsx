/**
 * @module app/(private)/schedule/__tests__/usual-week.behavior.test
 *
 * S11: the usual-week route forks by role — parent/helper get the existing
 * `SchedulePendingScreen`, a nanny gets the new read-only
 * `NannyUsualWeekScreen`. Both real components are mocked out to marker
 * views (each has its own dedicated test file) so this only covers the
 * fork itself.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

const mockUseIsOnboarded = mock(
  (): { role: 'nanny' | 'parent' | 'helper' | null } => ({ role: 'parent' })
);
mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: mockUseIsOnboarded,
}));

mock.module('@/src/domains/schedule', () => {
  const React = require('react');
  return {
    SchedulePendingScreen: () =>
      React.createElement('View', { testID: 'schedule-pending-screen-mock' }),
    NannyUsualWeekScreen: () =>
      React.createElement('View', { testID: 'nanny-usual-week-screen-mock' }),
  };
});

let ScheduleUsualWeekRoute: typeof import('../usual-week').default;

beforeAll(async () => {
  ScheduleUsualWeekRoute = (await import('../usual-week')).default;
});

beforeEach(() => {
  mockUseIsOnboarded.mockReset();
  mockUseIsOnboarded.mockImplementation(() => ({ role: 'parent' }));
});

describe('ScheduleUsualWeekRoute', () => {
  it('renders SchedulePendingScreen for a parent', () => {
    const { getByTestId, queryByTestId } = render(<ScheduleUsualWeekRoute />);
    expect(getByTestId('schedule-pending-screen-mock')).toBeTruthy();
    expect(queryByTestId('nanny-usual-week-screen-mock')).toBeNull();
  });

  it('renders SchedulePendingScreen for a helper', () => {
    mockUseIsOnboarded.mockImplementation(() => ({ role: 'helper' }));
    const { getByTestId } = render(<ScheduleUsualWeekRoute />);
    expect(getByTestId('schedule-pending-screen-mock')).toBeTruthy();
  });

  it('renders NannyUsualWeekScreen for a nanny, never SchedulePendingScreen', () => {
    mockUseIsOnboarded.mockImplementation(() => ({ role: 'nanny' }));
    const { getByTestId, queryByTestId } = render(<ScheduleUsualWeekRoute />);
    expect(getByTestId('nanny-usual-week-screen-mock')).toBeTruthy();
    expect(queryByTestId('schedule-pending-screen-mock')).toBeNull();
  });
});

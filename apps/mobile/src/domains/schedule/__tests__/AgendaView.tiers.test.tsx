/**
 * @module domains/schedule/__tests__/AgendaView.tiers.test
 *
 * Pattern B (mock rendering, docs/09-TESTING.md §5) — FlashList is globally
 * mocked to a plain non-virtualized list (bun.setup.ts), so AgendaView can
 * be rendered for real here, unlike the sibling `AgendaView.test.ts` (source
 * inspection only).
 *
 * Covers P0-4: cancelled/declined rows drop to T4 (bg-muted, no elevation,
 * strikethrough), pending/draft rows get a T3 accent bar, confirmed/completed
 * rows are unchanged, and each day header gains a right-aligned total that
 * excludes cancelled/declined shifts.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { render } from '@testing-library/react-native';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: () => {} }),
  router: { push: () => {}, replace: () => {}, back: () => {} },
}));

mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({ data: [] }),
}));
mock.module('@/src/hooks/queries/useChildren', () => ({
  useChildren: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
  useHouseholdCarers: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
  useCreateParentCover: () => ({
    mutateAsync: async () => {},
    isPending: false,
  }),
}));
mock.module('@/src/hooks/mutations/useRemoveParentCover', () => ({
  useRemoveParentCover: () => ({
    mutateAsync: async () => {},
    isPending: false,
  }),
}));

let AgendaView: typeof import('../components/AgendaView').AgendaView;

beforeAll(async () => {
  AgendaView = (await import('../components/AgendaView')).AgendaView;
});

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: 'household-1',
    carer_id: 'carer-1',
    starts_at: '2026-08-03T13:00:00.000Z',
    ends_at: '2026-08-03T21:00:00.000Z', // 8h
    timezone: 'America/New_York',
    local_date: '2026-08-03',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift-1@steadily',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

describe('AgendaView row tiers (P0-4)', () => {
  it('T4: cancelled row drops to bg-muted with no elevation and struck-through, muted time text', () => {
    const { getByTestId } = render(
      <AgendaView
        shifts={[makeShift({ id: 's-cancelled', status: 'cancelled' })]}
        weekDates={['2026-08-03']}
      />
    );

    const row = getByTestId('schedule-shift-s-cancelled');
    expect(row.props.className).toContain('bg-muted');
    expect(row.props.className).not.toContain('bg-card');
    // No elevation.row boxShadow style on a resolved row.
    expect(row.props.style).toBeFalsy();
  });

  it('T4: declined row gets the same treatment as cancelled', () => {
    const { getByTestId } = render(
      <AgendaView
        shifts={[makeShift({ id: 's-declined', status: 'declined' })]}
        weekDates={['2026-08-03']}
      />
    );

    const row = getByTestId('schedule-shift-s-declined');
    expect(row.props.className).toContain('bg-muted');
    expect(row.props.style).toBeFalsy();
  });

  it('cancelled/declined rows stay fully readable — the StatusPill is unchanged', () => {
    const { getByTestId } = render(
      <AgendaView
        shifts={[makeShift({ id: 's-cancelled', status: 'cancelled' })]}
        weekDates={['2026-08-03']}
      />
    );

    expect(getByTestId('schedule-shift-status-s-cancelled')).toBeTruthy();
  });

  it('T3+accent: pending row keeps bg-card + elevation AND gets the inset accent bar', () => {
    const { getByTestId, queryByTestId } = render(
      <AgendaView
        shifts={[makeShift({ id: 's-pending', status: 'pending' })]}
        weekDates={['2026-08-03']}
      />
    );

    const row = getByTestId('schedule-shift-s-pending');
    expect(row.props.className).toContain('bg-card');
    expect(row.props.style).toBeTruthy();
    expect(queryByTestId('schedule-shift-accent-s-pending')).not.toBeNull();
  });

  it('draft row gets the same accent treatment as pending', () => {
    const { queryByTestId } = render(
      <AgendaView
        shifts={[makeShift({ id: 's-draft', status: 'draft' })]}
        weekDates={['2026-08-03']}
      />
    );

    expect(queryByTestId('schedule-shift-accent-s-draft')).not.toBeNull();
  });

  it('confirmed/completed rows are unchanged — bg-card, elevation, no accent bar', () => {
    const { getByTestId, queryByTestId } = render(
      <AgendaView
        shifts={[
          makeShift({ id: 's-confirmed', status: 'confirmed' }),
          makeShift({
            id: 's-completed',
            status: 'completed',
            local_date: '2026-08-04',
          }),
        ]}
        weekDates={['2026-08-03', '2026-08-04']}
      />
    );

    const confirmedRow = getByTestId('schedule-shift-s-confirmed');
    expect(confirmedRow.props.className).toContain('bg-card');
    expect(confirmedRow.props.style).toBeTruthy();
    expect(queryByTestId('schedule-shift-accent-s-confirmed')).toBeNull();

    const completedRow = getByTestId('schedule-shift-s-completed');
    expect(completedRow.props.className).toContain('bg-card');
    expect(queryByTestId('schedule-shift-accent-s-completed')).toBeNull();
  });
});

describe('AgendaView day totals (P0-4)', () => {
  it('sums confirmed + pending shifts for the day, excluding cancelled/declined', () => {
    const { getByTestId } = render(
      <AgendaView
        shifts={[
          makeShift({
            id: 's1',
            status: 'confirmed',
            starts_at: '2026-08-03T09:00:00.000Z',
            ends_at: '2026-08-03T13:00:00.000Z', // 4h
          }),
          makeShift({
            id: 's2',
            status: 'pending',
            starts_at: '2026-08-03T14:00:00.000Z',
            ends_at: '2026-08-03T18:00:00.000Z', // 4h
          }),
          makeShift({
            id: 's3',
            status: 'cancelled',
            starts_at: '2026-08-03T18:00:00.000Z',
            ends_at: '2026-08-03T22:00:00.000Z', // excluded
          }),
        ]}
        weekDates={['2026-08-03']}
      />
    );

    expect(getByTestId('schedule-day-total-2026-08-03').props.children).toBe(
      '8h'
    );
  });

  it('shows 0m when every shift that day is cancelled/declined — an honest "no cover" signal', () => {
    const { getByTestId } = render(
      <AgendaView
        shifts={[makeShift({ id: 's-only-cancelled', status: 'cancelled' })]}
        weekDates={['2026-08-03']}
      />
    );

    expect(getByTestId('schedule-day-total-2026-08-03').props.children).toBe(
      '0m'
    );
  });

  it('renders no total for a day with no shifts (Away-only day)', () => {
    const { queryByTestId } = render(
      <AgendaView
        shifts={[]}
        timeOff={[
          {
            id: 'off-1',
            starts_at: '2026-08-03T00:00:00.000Z',
            ends_at: '2026-08-04T00:00:00.000Z',
            status: 'confirmed',
            message: null,
          } as never,
        ]}
        weekDates={['2026-08-03']}
        householdTimeZone="America/New_York"
      />
    );

    expect(queryByTestId('schedule-day-total-2026-08-03')).toBeNull();
  });
});

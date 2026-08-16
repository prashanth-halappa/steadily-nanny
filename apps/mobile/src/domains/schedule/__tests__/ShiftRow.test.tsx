/**
 * @module domains/schedule/__tests__/ShiftRow.test
 *
 * Pattern B (mock rendering, docs/09-TESTING.md §5). The row used to live
 * inside AgendaView; these tests pin the extracted contract — time, status,
 * live dot, parent-cover undo — and the P1 additions: child chips and a
 * carer avatar gated the same way as the carer name.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { fireEvent, render } from '@testing-library/react-native';
import { formatShiftTime } from '@/src/domains/schedule/utils/shiftGrouping';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: () => {} }),
  router: { push: () => {}, replace: () => {}, back: () => {} },
}));

const mockMutateAsync = mock(async () => {});

mock.module('@/src/hooks/mutations/useRemoveParentCover', () => ({
  useRemoveParentCover: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

let ShiftRow: typeof import('../components/ShiftRow').ShiftRow;

beforeAll(async () => {
  ShiftRow = (await import('../components/ShiftRow')).ShiftRow;
});

const TZ = 'America/New_York';

const MEMBER_LABELS = {
  you: 'You',
  someone: 'Someone',
  roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') => role,
};

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: '11111111-1111-4111-8111-111111111111',
    carer_id: '22222222-2222-4222-8222-222222222222',
    starts_at: '2026-08-03T13:00:00.000Z',
    ends_at: '2026-08-03T21:00:00.000Z',
    timezone: TZ,
    local_date: '2026-08-03',
    kind: 'recurring',
    status: 'pending',
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

const defaultProps = {
  displayTimeZone: TZ,
  currentUserId: null as string | null,
  membersByUserId: new Map(),
  memberLabels: MEMBER_LABELS,
};

describe('ShiftRow', () => {
  it('renders the time range, the status pill and the live dot exactly as before', () => {
    const pending = makeShift({ id: 'pending-1', status: 'pending' });
    const pendingRender = render(
      <ShiftRow {...defaultProps} shift={pending} />
    );
    expect(pendingRender.getByTestId('schedule-shift-pending-1')).toBeTruthy();
    expect(
      pendingRender.getByTestId('schedule-shift-status-pending-1')
    ).toBeTruthy();
    const serialized = JSON.stringify(pendingRender.toJSON());
    expect(serialized).toContain(formatShiftTime(pending.starts_at, TZ));
    expect(serialized).toContain(formatShiftTime(pending.ends_at, TZ));
    pendingRender.unmount();

    const live = makeShift({
      id: 'live-1',
      status: 'confirmed',
      starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const liveRender = render(<ShiftRow {...defaultProps} shift={live} />);
    expect(liveRender.getByTestId('schedule-shift-live-live-1')).toBeTruthy();
    expect(liveRender.queryByTestId('schedule-shift-status-live-1')).toBeNull();
  });

  it('renders a chip per child on the shift, coloured by the child', () => {
    const shift = makeShift();
    const { getByTestId, getByText } = render(
      <ShiftRow
        {...defaultProps}
        shift={shift}
        assignedChildren={[
          { id: 'child-wren', name: 'Wren', colour: '#14B8A6' },
          { id: 'child-leo', name: 'Leo', colour: '#112233' },
        ]}
      />
    );

    expect(getByTestId('schedule-shift-children-shift-1')).toBeTruthy();
    expect(getByText('Wren')).toBeTruthy();
    expect(getByText('Leo')).toBeTruthy();
    expect(
      getByTestId('schedule-shift-child-child-wren-dot').props.style
    ).toEqual(expect.objectContaining({ backgroundColor: '#4C7A6A' }));
    expect(
      getByTestId('schedule-shift-child-child-leo-dot').props.style
    ).toEqual(expect.objectContaining({ backgroundColor: '#112233' }));
  });

  it('renders no child chips when the shift carries none', () => {
    const { queryByTestId } = render(
      <ShiftRow {...defaultProps} shift={makeShift()} />
    );
    expect(queryByTestId('schedule-shift-children-shift-1')).toBeNull();
  });

  it('renders the carer avatar when carer names are shown', () => {
    const { getByTestId } = render(
      <ShiftRow
        {...defaultProps}
        shift={makeShift()}
        carerName="Amara"
        carerColour="#112233"
      />
    );
    const avatar = getByTestId('schedule-shift-avatar-shift-1');
    expect(avatar).toBeTruthy();
    expect(avatar.props.className).toContain('h-8');
    expect(avatar.props.style).toEqual(
      expect.objectContaining({ backgroundColor: '#112233' })
    );
    expect(getByTestId('schedule-shift-carer-shift-1').props.children).toBe(
      'Amara'
    );
  });

  it('renders no avatar when carer names are hidden', () => {
    const { queryByTestId } = render(
      <ShiftRow {...defaultProps} shift={makeShift()} />
    );
    expect(queryByTestId('schedule-shift-avatar-shift-1')).toBeNull();
    expect(queryByTestId('schedule-shift-carer-shift-1')).toBeNull();
  });

  it('keeps the parent-cover row non-pressable with its undo action', () => {
    const shift = makeShift({
      id: 'cover-1',
      kind: 'parent_cover',
      status: 'confirmed',
      created_by: 'parent-1',
    });
    const { getByTestId } = render(
      <ShiftRow
        {...defaultProps}
        shift={shift}
        currentUserId="parent-1"
        showParentCoverUndo
      />
    );

    const row = getByTestId('schedule-shift-cover-1');
    expect(row.props.accessibilityRole).toBe('text');
    expect(row.props.onPress).toBeUndefined();
    expect(String(row.type)).toBe('View');

    fireEvent.press(getByTestId('schedule-parent-cover-undo-cover-1'));
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith({ shiftId: 'cover-1' });
  });
});

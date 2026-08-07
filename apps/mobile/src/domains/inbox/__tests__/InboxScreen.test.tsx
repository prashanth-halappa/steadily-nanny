/**
 * @module domains/inbox/__tests__/InboxScreen.test
 *
 * Pattern B — empty state + each pending-work item type when `useInboxItems`
 * returns data. Error channel must surface ErrorState + retry (never the
 * empty-success copy). Pattern A markers live in InboxScreen.source.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import type { InboxItem } from '../utils/buildInboxItems';

let InboxScreen: typeof import('../components/InboxScreen').InboxScreen;
let mockUseInboxItems: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;
let mockRefetch: ReturnType<typeof mock>;
let mockRespondMutate: ReturnType<typeof mock>;
let mockUseRespondToApproval: ReturnType<typeof mock>;

beforeAll(async () => {
  mockRefetch = mock(() => Promise.resolve());
  mockUseInboxItems = mock(() => ({
    items: [] as InboxItem[],
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }));
  mockPush = mock();
  mockRespondMutate = mock();
  mockUseRespondToApproval = mock(() => ({
    mutate: mockRespondMutate,
    isPending: false,
    variables: undefined,
  }));

  mock.module('@/src/domains/inbox/hooks/useInboxItems', () => ({
    useInboxItems: mockUseInboxItems,
  }));
  mock.module('@/src/hooks/mutations/useRespondToApproval', () => ({
    useRespondToApproval: mockUseRespondToApproval,
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock() }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: { timezone: 'UTC' },
      householdId: 'hh-1',
      households: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
      isError: false,
    }),
  }));
  mock.module('@/src/components/custom/ErrorState', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
      ErrorState: (props: { variant?: string; onRetry?: () => void }) =>
        React.createElement(
          Pressable,
          {
            testID: 'error-state',
            accessibilityRole: 'button',
            onPress: props.onRetry,
          },
          React.createElement(Text, null, 'error')
        ),
    };
  });

  const mod = await import('../components/InboxScreen');
  InboxScreen = mod.InboxScreen;
});

beforeEach(() => {
  mockUseInboxItems.mockClear?.();
  mockPush.mockClear?.();
  mockRefetch.mockClear?.();
  mockRespondMutate.mockClear?.();
  mockUseRespondToApproval.mockClear?.();
  mockUseInboxItems.mockImplementation(() => ({
    items: [] as InboxItem[],
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }));
  mockUseRespondToApproval.mockImplementation(() => ({
    mutate: mockRespondMutate,
    isPending: false,
    variables: undefined,
  }));
});

describe('InboxScreen', () => {
  it('shows the empty state when there is nothing pending', () => {
    const { getByTestId, queryByTestId } = render(<InboxScreen />);

    expect(getByTestId('inbox-screen')).toBeTruthy();
    expect(getByTestId('inbox-empty')).toBeTruthy();
    expect(queryByTestId('inbox-list')).toBeNull();
    expect(queryByTestId('error-state')).toBeNull();
  });

  it('renders the shared BackButton with its testID and a working back callback', () => {
    const { getByTestId } = render(<InboxScreen />);
    const back = getByTestId('inbox-back');
    expect(back.props.accessibilityRole).toBe('button');
    fireEvent.press(back);
    // useRouter's back is a bare mock() here — pressing must not throw.
  });

  it('surfaces ErrorState + retry on query failure — never empty-success', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [] as InboxItem[],
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    }));

    const { getByTestId, queryByTestId } = render(<InboxScreen />);

    expect(getByTestId('error-state')).toBeTruthy();
    expect(queryByTestId('inbox-empty')).toBeNull();
    fireEvent.press(getByTestId('error-state'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('renders a change-request row that deep-links to shift detail', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'change_request',
          id: 'cr-1',
          shiftId: 'shift-1',
          requestKind: 'time_change',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId, queryByTestId } = render(<InboxScreen />);

    expect(queryByTestId('inbox-empty')).toBeNull();
    const row = getByTestId('inbox-item-change_request-cr-1');
    expect(row).toBeTruthy();
    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/shifts/shift-1');
  });

  it('renders a co-parent approval row that deep-links to the shift when known', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'co_parent_approval',
          id: 'ap-1',
          householdId: 'hh-1',
          action: 'extra_shift',
          timeoutAt: '2026-08-04T12:00:00Z',
          shiftId: 'shift-9',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    const row = getByTestId('inbox-item-co_parent_approval-ap-1');
    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/shifts/shift-9');
  });

  it('fires the approve mutation from a co-parent approval row', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'co_parent_approval',
          id: 'ap-1',
          householdId: 'hh-1',
          action: 'extra_shift',
          timeoutAt: '2026-08-04T12:00:00Z',
          shiftId: 'shift-9',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    fireEvent.press(getByTestId('inbox-approval-approve-ap-1'));

    expect(mockRespondMutate).toHaveBeenCalledWith({
      householdId: 'hh-1',
      approvalId: 'ap-1',
      status: 'approved',
    });
  });

  it('fires the decline mutation from a co-parent approval row', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'co_parent_approval',
          id: 'ap-1',
          householdId: 'hh-1',
          action: 'extra_shift',
          timeoutAt: '2026-08-04T12:00:00Z',
          shiftId: 'shift-9',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    fireEvent.press(getByTestId('inbox-approval-decline-ap-1'));

    expect(mockRespondMutate).toHaveBeenCalledWith({
      householdId: 'hh-1',
      approvalId: 'ap-1',
      status: 'declined',
    });
  });

  it('disables approve/decline while the mutation for that row is in flight', () => {
    mockUseRespondToApproval.mockImplementation(() => ({
      mutate: mockRespondMutate,
      isPending: true,
      variables: {
        householdId: 'hh-1',
        approvalId: 'ap-1',
        status: 'approved',
      },
    }));
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'co_parent_approval',
          id: 'ap-1',
          householdId: 'hh-1',
          action: 'extra_shift',
          timeoutAt: '2026-08-04T12:00:00Z',
          shiftId: 'shift-9',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);

    expect(getByTestId('inbox-approval-approve-ap-1').props.disabled).toBe(
      true
    );
    expect(getByTestId('inbox-approval-decline-ap-1').props.disabled).toBe(
      true
    );
  });

  it('does not disable approve/decline for a row that is not the in-flight one', () => {
    mockUseRespondToApproval.mockImplementation(() => ({
      mutate: mockRespondMutate,
      isPending: true,
      variables: {
        householdId: 'hh-1',
        approvalId: 'ap-other',
        status: 'approved',
      },
    }));
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'co_parent_approval',
          id: 'ap-1',
          householdId: 'hh-1',
          action: 'extra_shift',
          timeoutAt: '2026-08-04T12:00:00Z',
          shiftId: 'shift-9',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);

    expect(
      getByTestId('inbox-approval-approve-ap-1').props.disabled
    ).toBeFalsy();
  });

  it('renders a pending-pattern row that deep-links to respond', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'pending_pattern',
          id: 'pat-1',
          patternId: 'pat-1',
          dtstart: '2026-08-05',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    const row = getByTestId('inbox-item-pending_pattern-pat-1');
    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/respond/pat-1');
  });

  it('renders a queried-week row that deep-links to Hours', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'queried_week',
          id: 'ts-1',
          weekStart: '2026-07-28',
          queryNote: 'Break looks long',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    const row = getByTestId('inbox-item-queried_week-ts-1');
    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith(
      '/(private)/(tabs)/hours?weekStart=2026-07-28'
    );
  });

  it('renders a submitted-week row that deep-links to Hours', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'submitted_week',
          id: 'ts-2',
          weekStart: '2026-08-04',
          carerDisplayName: 'Jamie Carer',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    const row = getByTestId('inbox-item-submitted_week-ts-2');
    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith(
      '/(private)/(tabs)/hours?weekStart=2026-08-04'
    );
  });
});

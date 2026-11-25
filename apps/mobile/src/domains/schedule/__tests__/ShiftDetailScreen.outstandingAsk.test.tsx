/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.outstandingAsk.test
 *
 * §2a — a parent viewing an UNANSWERED one-off cover ask gets "Change the
 * ask" + "Withdraw the ask" and a note in place of the time picker, Save-
 * for-times, and "Cancel shift". Note editing stays. Any other pending
 * shift keeps today's editor.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { mockAlertDialogPrimitive } from './mockAlertDialog';

mockAlertDialogPrimitive();

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

let ShiftDetailScreen: typeof import('../components/ShiftDetailScreen').ShiftDetailScreen;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';
const CHILD_ID = '99999999-9999-4999-8999-999999999999';

const askShift = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  starts_at: '2030-08-05T08:00:00.000Z',
  ends_at: '2030-08-05T12:00:00.000Z',
  timezone: 'UTC',
  local_date: '2030-08-05',
  kind: 'extra',
  status: 'pending',
  cover_ask_expires_at: '2030-08-04T08:00:00.000Z',
  source_pattern_id: null,
  origin: 'parent_proposed',
  is_short_notice: false,
  note: 'old note',
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
  shift_children: [
    { id: 'link-1', child_id: CHILD_ID, starts_at: null, ends_at: null },
  ],
};

let currentShift: Record<string, unknown> = askShift;
const mockBack = mock();
const mockPush = mock();
const mockWithdraw = mock((_id: string) => Promise.resolve(askShift));
const mockUpdate = mock((_args: unknown) => Promise.resolve(askShift));

beforeAll(async () => {
  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mockBack, push: mockPush }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: () => ({ data: currentShift, isLoading: false }),
  }));
  // S3/S4 (3-T3): the screen now reads the carer's arrangement for the
  // cancel dialog's pay sentence and the household for the co-parent
  // restricted state. Stubbed here so this suite keeps testing its own
  // subject — see ShiftDetailScreen.cancelPay.test.tsx for their behaviour.
  mock.module('@/src/hooks/queries/usePayArrangementOn', () => ({
    usePayArrangementOn: () => ({ data: null, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useHouseholds', () => ({
    useHouseholds: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useRestrictedAction', () => ({
    useRestrictedAction: () => ({ disabled: false, reason: null }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      role: 'parent',
      status: 'onboarded',
      // Pattern A: role is resolved against the SHIFT's household.
      membershipRole: 'owner',
      householdId: HOUSEHOLD_ID,
    }),
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({
      data: { timezone: 'America/New_York', week_starts_on: 1 },
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: [
        {
          user_id: CARER_ID,
          role: 'nanny',
          display_name_override: 'Andrea Lopez',
          profile_name: null,
        },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useUpdateShift', () => ({
    useUpdateShift: () => ({
      mutateAsync: mockUpdate,
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useCreateShiftChangeRequest', () => ({
    useCreateShiftChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useRespondToShiftChangeRequest', () => ({
    useRespondToShiftChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useAcceptShift', () => ({
    useAcceptShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useDeclineShift', () => ({
    useDeclineShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useWithdrawCoverAsk', () => ({
    useWithdrawCoverAsk: () => ({
      mutateAsync: mockWithdraw,
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useWithdrawChangeRequest', () => ({
    useWithdrawChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: null }),
  }));
  mock.module('@/src/lib/toast', () => ({
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  currentShift = askShift;
  for (const m of [mockBack, mockPush, mockWithdraw, mockUpdate]) m.mockClear();
  mockWithdraw.mockImplementation(() => Promise.resolve(askShift));
});

describe('ShiftDetailScreen — outstanding cover ask (parent)', () => {
  it('swaps the time editor and cancel for the ask actions; the note stays', () => {
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);
    expect(getByTestId('shift-detail-ask-note')).toBeTruthy();
    expect(getByTestId('shift-detail-change-ask')).toBeTruthy();
    expect(getByTestId('shift-detail-withdraw-ask')).toBeTruthy();
    expect(getByTestId('shift-detail-note')).toBeTruthy();
    expect(queryByTestId('shift-detail-times')).toBeNull();
    expect(queryByTestId('shift-detail-cancel')).toBeNull();
  });

  it('saves the note alone, never the times', async () => {
    const { getByTestId } = render(<ShiftDetailScreen />);
    fireEvent.changeText(getByTestId('shift-detail-note'), 'gate code 12');
    fireEvent.press(getByTestId('shift-detail-save'));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        shiftId: SHIFT_ID,
        input: { note: 'gate code 12' },
      })
    );
  });

  it('"Change the ask" opens the extra form prefilled, replacing this ask', () => {
    const { getByTestId } = render(<ShiftDetailScreen />);
    fireEvent.press(getByTestId('shift-detail-change-ask'));
    const href = String(mockPush.mock.calls[0]?.[0]);
    expect(href.startsWith('/(private)/schedule/shifts/extra?')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('date')).toBe('2030-08-05');
    expect(q.get('start')).toBe('08:00');
    expect(q.get('end')).toBe('12:00');
    expect(q.get('childId')).toBe(CHILD_ID);
    expect(q.get('carerId')).toBe(CARER_ID);
    expect(q.get('replacesShiftId')).toBe(SHIFT_ID);
  });

  it('withdraws only after the confirm, then goes back', async () => {
    const { getByTestId } = render(<ShiftDetailScreen />);
    fireEvent.press(getByTestId('shift-detail-withdraw-ask'));
    expect(mockWithdraw).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('shift-detail-withdraw-ask-confirm'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockWithdraw).toHaveBeenCalledWith(SHIFT_ID);
  });

  it('keeps the dialog open with an error when the withdraw fails', async () => {
    mockWithdraw.mockImplementation(() => Promise.reject(new Error('x')));
    const { getByTestId } = render(<ShiftDetailScreen />);
    fireEvent.press(getByTestId('shift-detail-withdraw-ask'));
    fireEvent.press(getByTestId('shift-detail-withdraw-ask-confirm'));
    await waitFor(() =>
      expect(getByTestId('shift-detail-withdraw-ask-error')).toBeTruthy()
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('"Keep the ask" dismisses without withdrawing', () => {
    const { getByTestId } = render(<ShiftDetailScreen />);
    fireEvent.press(getByTestId('shift-detail-withdraw-ask'));
    fireEvent.press(getByTestId('shift-detail-withdraw-ask-keep'));
    expect(mockWithdraw).not.toHaveBeenCalled();
  });

  it('a pending shift that is not an outstanding ask keeps the editor', () => {
    // Pattern-materialised / demoted: no stamped answer-by.
    currentShift = { ...askShift, cover_ask_expires_at: null };
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);
    expect(getByTestId('shift-detail-times')).toBeTruthy();
    expect(getByTestId('shift-detail-cancel')).toBeTruthy();
    expect(queryByTestId('shift-detail-ask-note')).toBeNull();
    expect(queryByTestId('shift-detail-change-ask')).toBeNull();
    expect(queryByTestId('shift-detail-withdraw-ask')).toBeNull();
  });
});

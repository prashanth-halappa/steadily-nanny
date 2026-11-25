/**
 * @module domains/schedule/__tests__/AgendaView.pendingAsk.test
 *
 * Layout spec §2a: an outstanding one-off cover ask (pending, extra/cover,
 * a carer, a fuse — `isOutstandingCoverAsk`) carries its own action row on
 * the Agenda for a parent who may act: "Change the ask" re-asks through the
 * extra screen (`replacesShiftId`), "Withdraw the ask" confirms, then
 * withdraws. Any other pending row, and any viewer who can't act, keeps the
 * plain row.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { mockAlertDialogPrimitive } from './mockAlertDialog';

mockAlertDialogPrimitive();

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TZ = 'Europe/London';
const DATE = '2026-08-04';

const mockPush = mock();
const mockWithdraw = mock((_id: string) => Promise.resolve({}));

beforeAll(() => {
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
    router: { push: mockPush, replace: () => {}, back: () => {} },
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({ data: [] }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({ data: [] }),
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
  mock.module('@/src/hooks/mutations/useWithdrawCoverAsk', () => ({
    useWithdrawCoverAsk: () => ({
      mutateAsync: mockWithdraw,
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
  }));
});

let AgendaView: typeof import('../components/AgendaView').AgendaView;

beforeAll(async () => {
  AgendaView = (await import('../components/AgendaView')).AgendaView;
});

function ask(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-ask',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    starts_at: `${DATE}T07:00:00.000Z`,
    ends_at: `${DATE}T08:00:00.000Z`,
    timezone: TZ,
    local_date: DATE,
    kind: 'extra',
    status: 'pending',
    cover_ask_expires_at: '2026-08-03T20:00:00.000Z',
    shift_children: [
      {
        shift_id: 'shift-ask',
        child_id: CHILD_ID,
        starts_at: null,
        ends_at: null,
      },
    ],
    ...overrides,
  } as Shift;
}

function renderRow(shift: Shift, showUncoveredActions = true) {
  return render(
    <AgendaView
      shifts={[shift]}
      householdId={HOUSEHOLD_ID}
      displayTimeZone={TZ}
      householdTimeZone={TZ}
      weekDates={[DATE]}
      showUncoveredActions={showUncoveredActions}
    />
  );
}

describe('AgendaView pending ask actions', () => {
  it('an outstanding ask gets "Change the ask" → the extra screen, replacing this shift', () => {
    mockPush.mockClear();
    const utils = renderRow(ask());

    expect(
      utils.getByTestId('schedule-shift-ask-actions-shift-ask')
    ).toBeTruthy();
    fireEvent.press(utils.getByTestId('schedule-shift-change-ask-shift-ask'));
    const href = String(mockPush.mock.calls[0]?.[0]);
    expect(href.startsWith('/(private)/schedule/shifts/extra?')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('replacesShiftId')).toBe('shift-ask');
    expect(q.get('date')).toBe(DATE);
    expect(q.get('start')).toBe('08:00');
    expect(q.get('end')).toBe('09:00');
    expect(q.get('childId')).toBe(CHILD_ID);
    expect(q.get('carerId')).toBe(CARER_ID);
  });

  it('"Withdraw the ask" withdraws only after the confirm', async () => {
    mockWithdraw.mockClear();
    const utils = renderRow(ask());

    fireEvent.press(utils.getByTestId('schedule-shift-withdraw-ask-shift-ask'));
    expect(mockWithdraw).not.toHaveBeenCalled();
    fireEvent.press(
      utils.getByTestId('schedule-shift-withdraw-ask-shift-ask-confirm')
    );
    await waitFor(() => expect(mockWithdraw).toHaveBeenCalledWith('shift-ask'));
  });

  it('a failed withdraw keeps the dialog open with an error', async () => {
    mockWithdraw.mockImplementationOnce(() => Promise.reject(new Error('x')));
    const utils = renderRow(ask());

    fireEvent.press(utils.getByTestId('schedule-shift-withdraw-ask-shift-ask'));
    fireEvent.press(
      utils.getByTestId('schedule-shift-withdraw-ask-shift-ask-confirm')
    );
    await waitFor(() =>
      expect(
        utils.getByTestId('schedule-shift-withdraw-ask-shift-ask-error')
      ).toBeTruthy()
    );
  });

  it('no action row for a pending shift that is not an outstanding ask, or for a viewer who cannot act', () => {
    const pattern = renderRow(
      ask({ kind: 'recurring', cover_ask_expires_at: null })
    );
    expect(
      pattern.queryByTestId('schedule-shift-ask-actions-shift-ask')
    ).toBeNull();
    pattern.unmount();

    const nanny = renderRow(ask(), false);
    expect(
      nanny.queryByTestId('schedule-shift-ask-actions-shift-ask')
    ).toBeNull();
    // The row itself still renders and still taps through.
    expect(nanny.getByTestId('schedule-shift-shift-ask')).toBeTruthy();
  });
});

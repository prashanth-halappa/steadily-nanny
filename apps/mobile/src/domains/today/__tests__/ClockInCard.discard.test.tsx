/**
 * @module domains/today/__tests__/ClockInCard.discard
 *
 * 069 — discarding a clock-in that should never have happened.
 *
 * "I tapped Clock in by mistake" was the primary motivation for voiding, and
 * for a while it was the one case with no path at all: void was reachable
 * only from the Hours correction sheet, which requires a FINISHED entry. A
 * carer had to clock out first — banking a nonsense entry — and then void it.
 *
 * The affordance lives on the card, not in the clock-out sheet, for two
 * reasons this file pins: the sheet refuses a zero-length finish for a full
 * minute after clock-in (`isZeroLength`), so it is a dead end for exactly
 * this person; and the card is in the ordinary JS tree, so the confirm
 * AlertDialog renders normally instead of behind a native modal window
 * (GOLDEN-FIXES #40).
 *
 * Same shape as `ClockInCard.clockout.test.tsx`: the real card, a real
 * QueryClient, only the API leaf mocked.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  TIME_ENTRY_KINDS,
  TIME_ENTRY_STATUSES,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

// @rn-primitives/alert-dialog's .mjs distribution isn't pre-compiled for
// bun:test.
mock.module('@rn-primitives/alert-dialog', () => {
  const React = require('react');
  const Ctx = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  });

  return {
    Root: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => {
      const setOpen = (next: boolean) => onOpenChange?.(next);
      return React.createElement(
        Ctx.Provider,
        { value: { open: open ?? false, setOpen } },
        children
      );
    },
    Trigger: ({ children }: { children: React.ReactNode }) => children,
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const { open } = React.useContext(Ctx);
      return open ? React.createElement('View', props, children) : null;
    },
    Content: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('View', props, children),
    Title: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Description: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Cancel: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    Action: ({
      children,
      onPress,
      disabled,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      disabled?: boolean;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          disabled,
          onPress: (e: unknown) => {
            if (disabled) return;
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    useRootContext: () => React.useContext(Ctx),
  };
});

const HOUSEHOLD_ID = 'household-1';
const TIME_ZONE = 'UTC';
/** Seconds ago — the accidental clock-in this feature exists for. */
const JUST_NOW = new Date(Date.now() - 20 * 1000).toISOString();
/** Well past DISCARD_ELAPSED_HINT_MS, so the confirm names the duration. */
const LONG_AGO = new Date(Date.now() - 80 * 60 * 1000).toISOString();

const runningEntry = (clockInAt: string) => ({
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  clock_in_at: clockInAt,
  status: 'running',
});

const getRunningMock = mock(() => Promise.resolve<unknown>(null));
const voidMock = mock((..._args: unknown[]) =>
  Promise.resolve({ ...runningEntry(JUST_NOW), status: 'voided' })
);
const showErrorToastMock = mock((..._args: unknown[]) => {});

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: {
    getRunning: getRunningMock,
    clockIn: mock(),
    clockOut: mock(),
    void: voidMock,
  },
  // §11.1's `earningsStructureLine` chain pulls these re-exported
  // constants in transitively — real, pure, sync values, so this mock
  // stays a complete stand-in instead of throwing on a named export it
  // never provided.
  TIME_ENTRY_KINDS,
  TIME_ENTRY_STATUSES,
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: mock(),
  showInfoToast: mock(),
  showWarningToast: mock(),
  useToast: () => ({ show: mock() }),
}));

// Dynamic import AFTER the mock.module calls above — a static import is
// hoisted and would resolve @rn-primitives/alert-dialog's raw-JSX .mjs before
// the stand-in is registered. Same pattern as ApproveWeekDialog.test.tsx.
let ClockInCard: typeof import('../components/ClockInCard').ClockInCard;

beforeAll(async () => {
  ClockInCard = (await import('../components/ClockInCard')).ClockInCard;
});

beforeEach(() => {
  getRunningMock.mockReset();
  voidMock.mockReset();
  showErrorToastMock.mockReset();
  voidMock.mockImplementation(() =>
    Promise.resolve({ ...runningEntry(JUST_NOW), status: 'voided' })
  );
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

function renderCard(clockInAt = JUST_NOW) {
  getRunningMock.mockImplementation(() =>
    Promise.resolve(runningEntry(clockInAt))
  );
  return renderWithProviders(
    <ClockInCard
      householdId={HOUSEHOLD_ID}
      timeZone={TIME_ZONE}
      weekStartsOn={1}
    />
  );
}

describe('ClockInCard — discard a clock-in (069)', () => {
  it('offers the discard only while on the clock', async () => {
    getRunningMock.mockImplementation(() => Promise.resolve(null));
    const { queryByTestId, getByTestId } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(queryByTestId('today-discard-entry')).toBeNull();
  });

  it('confirms before discarding — it writes to a record her household reads', async () => {
    const { getByTestId } = renderCard();

    await waitFor(() =>
      expect(getByTestId('today-discard-entry')).toBeTruthy()
    );
    fireEvent.press(getByTestId('today-discard-entry'));

    await waitFor(() =>
      expect(getByTestId('today-discard-dialog')).toBeTruthy()
    );
    // Nothing is sent until she confirms.
    expect(voidMock).not.toHaveBeenCalled();
  });

  it('discards the running entry on confirm', async () => {
    const { getByTestId } = renderCard();

    await waitFor(() =>
      expect(getByTestId('today-discard-entry')).toBeTruthy()
    );
    fireEvent.press(getByTestId('today-discard-entry'));
    await waitFor(() =>
      expect(getByTestId('today-discard-dialog-confirm')).toBeTruthy()
    );
    fireEvent.press(getByTestId('today-discard-dialog-confirm'));

    await waitFor(() => expect(voidMock).toHaveBeenCalledWith('entry-1'));
  });

  it('cancelling sends nothing', async () => {
    const { getByTestId } = renderCard();

    await waitFor(() =>
      expect(getByTestId('today-discard-entry')).toBeTruthy()
    );
    fireEvent.press(getByTestId('today-discard-entry'));
    await waitFor(() =>
      expect(getByTestId('today-discard-dialog-cancel')).toBeTruthy()
    );
    fireEvent.press(getByTestId('today-discard-dialog-cancel'));

    expect(voidMock).not.toHaveBeenCalled();
  });

  it('names the duration once past the ten-minute threshold', async () => {
    const { getByTestId } = renderCard(LONG_AGO);

    await waitFor(() =>
      expect(getByTestId('today-discard-entry')).toBeTruthy()
    );
    fireEvent.press(getByTestId('today-discard-entry'));

    await waitFor(() =>
      expect(getByTestId('today-discard-dialog-body')).toBeTruthy()
    );
    // Key-echo i18n mock: the elapsed variant is a DIFFERENT key, which is
    // what proves the threshold branch ran. "I didn't mean to clock in" is
    // not enough said before discarding an hour that might be real work.
    expect(
      String(getByTestId('today-discard-dialog-body').props.children)
    ).toContain('confirmBodyElapsed');
  });

  it('uses the short body for a just-now mistake', async () => {
    const { getByTestId } = renderCard();

    await waitFor(() =>
      expect(getByTestId('today-discard-entry')).toBeTruthy()
    );
    fireEvent.press(getByTestId('today-discard-entry'));

    await waitFor(() =>
      expect(getByTestId('today-discard-dialog-body')).toBeTruthy()
    );
    const body = String(
      getByTestId('today-discard-dialog-body').props.children
    );
    expect(body).toContain('confirmBody');
    expect(body).not.toContain('confirmBodyElapsed');
  });

  it('surfaces a refusal as a toast — this path has no sheet to hide it', async () => {
    voidMock.mockImplementation(() =>
      Promise.reject({
        isAxiosError: true,
        response: {
          status: 409,
          data: { error: { code: 'CONFLICT', metadata: {} } },
        },
      })
    );
    const { getByTestId } = renderCard();

    await waitFor(() =>
      expect(getByTestId('today-discard-entry')).toBeTruthy()
    );
    fireEvent.press(getByTestId('today-discard-entry'));
    await waitFor(() =>
      expect(getByTestId('today-discard-dialog-confirm')).toBeTruthy()
    );
    fireEvent.press(getByTestId('today-discard-dialog-confirm'));

    await waitFor(() => expect(showErrorToastMock).toHaveBeenCalled());
  });
});

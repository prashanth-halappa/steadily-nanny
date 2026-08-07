/**
 * @module domains/timeOff/components/__tests__/SickTimeOffButton.test
 *
 * "I'm sick today" quick action (067) — confirms via `AlertDialog` (never a
 * bare RN `Modal`, GOLDEN-FIX #1) with copy that plainly says the family
 * will be notified, then creates a SAME-DAY (`today, today`), `all_day`,
 * `kind: 'sick'` time-off request. `@rn-primitives/alert-dialog` is mocked
 * with the same Ctx-based stand-in `TimeOffScreen.test.tsx` uses (its .mjs
 * distribution isn't pre-compiled for bun:test).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';

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
    Trigger: ({
      children,
      onPress,
      disabled,
      ...props
    }: {
      children: React.ReactNode;
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
            onPress?.(e);
            if (!disabled) setOpen(true);
          },
        },
        children
      );
    },
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
    useRootContext: () => React.useContext(Ctx),
  };
});

const mutateAsync = mock((_input: unknown) =>
  Promise.resolve({ id: '1', status: 'confirmed', kind: 'sick' })
);
const mockUseRequestTimeOff = mock(() => ({
  mutateAsync,
  isPending: false,
}));

mock.module('@/src/hooks/mutations/useRequestTimeOff', () => ({
  useRequestTimeOff: mockUseRequestTimeOff,
}));

const showSuccessToastMock = mock(() => {});
mock.module('@/src/lib/toast', () => ({
  showSuccessToast: showSuccessToastMock,
  showErrorToast: mock(() => {}),
}));

let SickTimeOffButton: typeof import('../SickTimeOffButton').SickTimeOffButton;

beforeAll(async () => {
  SickTimeOffButton = (await import('../SickTimeOffButton')).SickTimeOffButton;
});

describe('SickTimeOffButton', () => {
  it('does not submit until the AlertDialog confirm is pressed', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <SickTimeOffButton />
    );

    expect(queryByTestId('time-off-sick-confirm')).toBeNull();
    fireEvent.press(getByTestId('time-off-sick-today'));
    expect(getByTestId('time-off-sick-confirm')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('creates a same-day, all_day, kind: "sick" request on confirm', async () => {
    mutateAsync.mockClear();
    const { getByTestId } = renderWithProviders(<SickTimeOffButton />);

    fireEvent.press(getByTestId('time-off-sick-today'));
    fireEvent.press(getByTestId('time-off-sick-confirm'));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const call = mutateAsync.mock.calls[0]?.[0] as {
      starts_at: string;
      ends_at: string;
      all_day: boolean;
      kind?: string;
    };
    expect(call.all_day).toBe(true);
    expect(call.kind).toBe('sick');
    // Same-day: starts_at and ends_at both derive from the same calendar
    // date (an exclusive one-day span), never a multi-day range.
    const start = new Date(call.starts_at);
    const end = new Date(call.ends_at);
    end.setDate(end.getDate() - 1);
    expect(start.toDateString()).toBe(end.toDateString());
  });

  it('shows a success toast after a confirmed sick-day request', async () => {
    showSuccessToastMock.mockClear();
    const { getByTestId } = renderWithProviders(<SickTimeOffButton />);

    fireEvent.press(getByTestId('time-off-sick-today'));
    fireEvent.press(getByTestId('time-off-sick-confirm'));

    await waitFor(() => expect(showSuccessToastMock).toHaveBeenCalled());
  });

  it('states plainly in the confirm copy that the family will be notified', () => {
    const { getByTestId, getByText } = renderWithProviders(
      <SickTimeOffButton />
    );

    fireEvent.press(getByTestId('time-off-sick-today'));
    expect(getByText('sickConfirmBody')).toBeTruthy();
  });
});

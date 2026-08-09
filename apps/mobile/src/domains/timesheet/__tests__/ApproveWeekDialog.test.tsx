/**
 * @module domains/timesheet/__tests__/ApproveWeekDialog.test
 * TIER0-CX-SPEC.md §4.3.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

// Same stand-in as ManageHouseholdScreen.test / TimeOffScreen.test —
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

let ApproveWeekDialog: typeof import('../components/ApproveWeekDialog').ApproveWeekDialog;

beforeAll(async () => {
  ApproveWeekDialog = (await import('../components/ApproveWeekDialog'))
    .ApproveWeekDialog;
});

describe('ApproveWeekDialog', () => {
  it('shows hours + gross as text in the body when an arrangement exists', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
      />
    );

    expect(getByTestId('hours-approve-dialog-title').props.children).toBe(
      'approveDialogTitle'
    );
    const body = getByTestId('hours-approve-dialog-body').props.children;
    expect(body).toBe('approveDialogBody');
  });

  it('renders the no-arrangement body variant when grossLabel is null', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel={null}
        earningsStatus="no_arrangement"
        carerName="Amara"
      />
    );

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialogBodyNoArrangement'
    );
  });

  it('renders the currency-change body variant when earnings span two currencies', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel={null}
        earningsStatus="currency_change"
        carerName="Amara"
      />
    );

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialogBodyCurrencyChange'
    );
  });

  it('cancel is "Not yet" and confirm is "Approve the week" — and confirm fires onConfirm', () => {
    const onConfirm = mock();
    const { getByTestId, getByText } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
      />
    );

    expect(getByText('approveDialogCancel')).toBeTruthy();
    expect(getByText('approveDialogConfirm')).toBeTruthy();

    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm action while submitting', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
      />
    );

    expect(getByTestId('hours-approve-dialog-confirm').props.disabled).toBe(
      true
    );
  });

  it('renders nothing (dialog closed) when open is false', () => {
    const { queryByTestId } = render(
      <ApproveWeekDialog
        open={false}
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
      />
    );

    expect(queryByTestId('hours-approve-dialog-title')).toBeNull();
  });
});

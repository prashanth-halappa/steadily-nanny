/**
 * @module domains/timesheet/__tests__/ReopenWeekDialog.test
 *
 * Confirmation for parent reopen — mirrors ApproveWeekDialog's AlertDialog
 * structure and testID naming, plus a required reason field.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

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

let ReopenWeekDialog: typeof import('../components/ReopenWeekDialog').ReopenWeekDialog;

beforeAll(async () => {
  ReopenWeekDialog = (await import('../components/ReopenWeekDialog'))
    .ReopenWeekDialog;
});

describe('ReopenWeekDialog', () => {
  it('shows the reopen body and collects a reason before confirm fires', () => {
    const onConfirm = mock();
    const { getByTestId, getByText } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
      />
    );

    expect(getByTestId('hours-reopen-dialog-title').props.children).toBe(
      'reopenDialogTitle'
    );
    expect(getByTestId('hours-reopen-dialog-body').props.children).toBe(
      'reopenDialogBody'
    );
    expect(getByText('reopenDialogCancel')).toBeTruthy();
    expect(getByText('reopenDialogConfirm')).toBeTruthy();

    expect(getByTestId('hours-reopen-dialog-confirm').props.disabled).toBe(
      true
    );

    fireEvent.changeText(
      getByTestId('hours-reopen-dialog-reason'),
      'Thursday hours were wrong'
    );
    expect(getByTestId('hours-reopen-dialog-confirm').props.disabled).toBe(
      false
    );

    fireEvent.press(getByTestId('hours-reopen-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('Thursday hours were wrong');
  });

  it('disables confirm while submitting', () => {
    const { getByTestId } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting
        weekRangeLabel="3 – 9 August"
      />
    );

    fireEvent.changeText(
      getByTestId('hours-reopen-dialog-reason'),
      'Need a correction'
    );
    expect(getByTestId('hours-reopen-dialog-confirm').props.disabled).toBe(
      true
    );
  });

  it('renders nothing when open is false', () => {
    const { queryByTestId } = render(
      <ReopenWeekDialog
        open={false}
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
      />
    );

    expect(queryByTestId('hours-reopen-dialog-title')).toBeNull();
  });
});

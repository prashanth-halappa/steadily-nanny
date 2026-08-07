/**
 * @module domains/schedule/__tests__/mockAlertDialog
 *
 * `@rn-primitives/alert-dialog`'s .mjs distribution isn't pre-compiled JSX,
 * so it cannot be imported under bun:test — same stand-in as
 * `TimeEntryDayRow.test.tsx` / `ManageHouseholdScreen.test.tsx`. Call this
 * at module scope (before the dynamic import of the screen under test) in
 * any test that renders a component using `@/src/components/ui/alert-dialog`.
 */
import { mock } from 'bun:test';

export function mockAlertDialogPrimitive(): void {
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
      }) =>
        React.createElement(
          Ctx.Provider,
          {
            value: {
              open: open ?? false,
              setOpen: (next: boolean) => onOpenChange?.(next),
            },
          },
          children
        ),
      Trigger: ({
        children,
        ...props
      }: {
        children: React.ReactNode;
        [key: string]: unknown;
      }) => React.createElement('Pressable', props, children),
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
        ...props
      }: {
        children?: React.ReactNode;
        [key: string]: unknown;
      }) => React.createElement('Pressable', props, children),
      Action: ({
        children,
        ...props
      }: {
        children?: React.ReactNode;
        [key: string]: unknown;
      }) => React.createElement('Pressable', props, children),
      useRootContext: () => React.useContext(Ctx),
    };
  });
}

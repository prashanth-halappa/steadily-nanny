/**
 * @module components/ui/__tests__/alert-dialog.action
 *
 * The two destructive confirms in the app style their button by passing
 * `className={buttonVariants({ variant: 'destructive' })}`. `AlertDialogAction`
 * fed that same *button* class string into `buttonTextVariants()`, so the label
 * `<Text>` ended up carrying `active:opacity-90` plus the button's box classes.
 *
 * On device that is fatal, not cosmetic: react-native-css-interop attaches
 * `onPressIn`/`onPressOut`/`onPress` to any component whose classes need
 * :active state, and an RN `<Text>` with press handlers claims the touch
 * responder — so the Pressable underneath never fires and the confirm is inert.
 * `group-*` variants are resolved off the parent and attach nothing, which is
 * why Cancel and every className-free Action kept working.
 *
 * The responder theft itself is NOT reproducible under bun:test: bun.setup.ts
 * stubs the whole css-interop runtime, and `fireEvent.press` calls a Pressable's
 * onPress directly rather than running a hit test. What these tests pin is its
 * precondition — no button class may reach the label.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

// @rn-primitives/alert-dialog ships un-compiled JSX in its .mjs, which bun:test
// cannot parse (same stand-in reason as ManageHouseholdScreen.test). Only the
// leaf primitives matter here: our wrappers render those directly and never
// read the root context themselves.
mock.module('@rn-primitives/alert-dialog', () => {
  const React = require('react');
  const passthrough =
    (element: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(element, props, children);
  return {
    Root: passthrough('View'),
    Trigger: passthrough('Pressable'),
    Portal: passthrough('View'),
    Overlay: passthrough('View'),
    Content: passthrough('View'),
    Title: passthrough('Text'),
    Description: passthrough('Text'),
    Action: passthrough('Pressable'),
    Cancel: passthrough('Pressable'),
    useRootContext: () => ({ open: true, onOpenChange: () => {} }),
  };
});

// bun.setup.ts stubs buttonVariants/buttonTextVariants to return '' globally,
// which makes every button class invisible to every test — that stub is the
// reason this defect shipped green. Swap in a real `cva` stand-in so the
// class strings actually exist. The shapes below mirror button.tsx's contract:
// a self-scoped `active:` on the box, a `group-`-scoped one on the label.
mock.module('@/src/components/ui/button', () => {
  const { cva } = require('class-variance-authority');
  return {
    Button: 'Button',
    buttonVariants: cva('group flex items-center justify-center', {
      variants: {
        variant: {
          default: 'bg-primary active:opacity-90',
          destructive: 'bg-destructive active:opacity-90',
          outline: 'border-1.5 active:bg-accent',
        },
        size: { default: 'h-10 native:h-12 px-4' },
      },
      defaultVariants: { variant: 'default', size: 'default' },
    }),
    buttonTextVariants: cva('text-sm font-semibold', {
      variants: {
        variant: {
          default:
            'text-primary-foreground group-disabled:text-muted-foreground',
          destructive:
            'text-destructive-foreground group-disabled:text-muted-foreground',
          outline: 'group-active:text-accent-foreground',
        },
        size: { default: '' },
      },
      defaultVariants: { variant: 'default', size: 'default' },
    }),
  };
});

const {
  AlertDialogAction,
  AlertDialogCancel,
} = require('@/src/components/ui/alert-dialog');
const { buttonVariants } = require('@/src/components/ui/button');
const { Text } = require('@/src/components/ui/text');

const DESTRUCTIVE: string = buttonVariants({ variant: 'destructive' });

/** An `active:`/`hover:`/`focus:` variant scoped to the element itself. */
const SELF_INTERACTION_VARIANT = /(?<!group-)(?<!web:)(active|hover|focus):/;

describe('AlertDialogAction', () => {
  it('keeps a caller button className off the label text', () => {
    const { getByTestId } = render(
      <AlertDialogAction className={DESTRUCTIVE} testID="confirm">
        <Text testID="confirm-label">Remove</Text>
      </AlertDialogAction>
    );

    const label = getByTestId('confirm-label').props.className as string;
    expect(label).not.toMatch(SELF_INTERACTION_VARIANT);
    expect(label).not.toContain('bg-destructive');
    expect(label).not.toContain('native:h-12');
  });

  it('still applies the caller button className to the button itself', () => {
    const { getByTestId } = render(
      <AlertDialogAction className={DESTRUCTIVE} testID="confirm">
        <Text>Remove</Text>
      </AlertDialogAction>
    );

    const button = getByTestId('confirm').props.className as string;
    expect(button).toContain('bg-destructive');
    expect(button).toContain('active:opacity-90');
  });
});

describe('AlertDialogCancel', () => {
  it('keeps a caller button className off the label text', () => {
    const { getByTestId } = render(
      <AlertDialogCancel className={DESTRUCTIVE} testID="cancel">
        <Text testID="cancel-label">Cancel</Text>
      </AlertDialogCancel>
    );

    const label = getByTestId('cancel-label').props.className as string;
    expect(label).not.toMatch(SELF_INTERACTION_VARIANT);
    expect(label).not.toContain('bg-destructive');
  });
});

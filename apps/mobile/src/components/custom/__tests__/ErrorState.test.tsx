/**
 * @module components/custom/__tests__/ErrorState.test
 *
 * The design system's own spec never defines an error state — this pins the
 * rung it was given: bare ground (no Card — an error isn't a decision anyone
 * made, so it doesn't get a decision's surface), IconChip tone="brand", ONE
 * retry action styled `variant="outline"`. Restyle only — every existing
 * prop, variant name, testID and copy key keeps working.
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { ErrorState } from '../ErrorState';

describe('ErrorState', () => {
  it('renders on a bare ground — no card surface', () => {
    const { getByTestId } = render(<ErrorState />);
    const className = getByTestId('error-state').props.className as string;
    expect(className).not.toContain('bg-card');
    expect(className).not.toContain('rounded-card');
  });

  it('uses IconChip tone="brand" for the icon', () => {
    const { getByTestId } = render(<ErrorState />);
    expect(getByTestId('error-state-icon')).toBeTruthy();
  });

  it('renders the title and message for the given variant', () => {
    const { getByText } = render(<ErrorState variant="network" />);
    expect(getByText('states.network.title')).toBeTruthy();
    expect(getByText('states.network.message')).toBeTruthy();
  });

  it('honours a custom title/message override', () => {
    const { getByText } = render(
      <ErrorState title="Custom title" message="Custom message" />
    );
    expect(getByText('Custom title')).toBeTruthy();
    expect(getByText('Custom message')).toBeTruthy();
  });

  it('renders the retry action as an outline button, not the default variant', () => {
    // `@/src/components/ui/button` is globally stubbed in bun.setup.ts (a
    // bare string element, no cva) — assert the `variant` prop it was given
    // rather than a computed className, which the stub never produces.
    const { getByTestId } = render(<ErrorState onRetry={() => {}} />);
    expect(getByTestId('error-state-retry').props.variant).toBe('outline');
  });

  it('omits the retry action when onRetry is not given', () => {
    const { queryByText } = render(<ErrorState />);
    expect(queryByText('tryAgain')).toBeNull();
  });

  it('renders an optional secondary action', () => {
    const { getByText } = render(
      <ErrorState onSecondaryAction={() => {}} secondaryLabel="Go back" />
    );
    expect(getByText('Go back')).toBeTruthy();
  });
});

/**
 * @module domains/today/__tests__/ClockOutSheet
 *
 * D20 — break minutes/note were never collected at clock-out, so every
 * genuine unpaid break was recorded as worked time. This sheet is the fix.
 * Pattern B (mock rendering, docs/09-TESTING.md §5): a pure, prop-driven
 * component, so no QueryClientProvider needed — just the preload mocks.
 *
 * Covers: defaults to "no break" so confirming with zero taps on the break
 * picker still submits correctly (the "fast to skip" requirement); a quick
 * chip sets the break value; a typed custom value overrides the chips; the
 * note is trimmed; and the submitted payload is exactly what was entered.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { ClockOutSheet } from '../components/ClockOutSheet';

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

describe('ClockOutSheet', () => {
  it('confirming immediately (no interaction) submits no break and no note', () => {
    const onSubmit = mock();
    const { getByTestId } = render(
      <ClockOutSheet
        visible
        onDismiss={() => {}}
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );

    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({ breakMinutes: 0, note: '' });
  });

  it('a quick-pick chip sets the break minutes submitted', () => {
    const onSubmit = mock();
    const { getByTestId } = render(
      <ClockOutSheet
        visible
        onDismiss={() => {}}
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );

    fireEvent.press(getByTestId('clockout-break-30'));
    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({ breakMinutes: 30, note: '' });
  });

  it('a typed custom break value overrides the chips', () => {
    const onSubmit = mock();
    const { getByTestId } = render(
      <ClockOutSheet
        visible
        onDismiss={() => {}}
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );

    fireEvent.press(getByTestId('clockout-break-30'));
    fireEvent.changeText(getByTestId('clockout-break-custom'), '20');
    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({ breakMinutes: 20, note: '' });
  });

  it('an invalid custom break value falls back to zero rather than NaN', () => {
    const onSubmit = mock();
    const { getByTestId } = render(
      <ClockOutSheet
        visible
        onDismiss={() => {}}
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );

    fireEvent.changeText(getByTestId('clockout-break-custom'), 'abc');
    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({ breakMinutes: 0, note: '' });
  });

  it('submits a trimmed note alongside the break minutes', () => {
    const onSubmit = mock();
    const { getByTestId } = render(
      <ClockOutSheet
        visible
        onDismiss={() => {}}
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );

    fireEvent.press(getByTestId('clockout-break-15'));
    fireEvent.changeText(getByTestId('clockout-note'), '  covered pickup  ');
    fireEvent.press(getByTestId('clockout-confirm'));

    expect(onSubmit).toHaveBeenCalledWith({
      breakMinutes: 15,
      note: 'covered pickup',
    });
  });
});

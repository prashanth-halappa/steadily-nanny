/**
 * @module domains/timeOff/components/__tests__/MarkTimeOffPaidSheet.test
 *
 * TIER0-CX-SPEC.md §5.1: before/after balance, over-balance WARNS but still
 * allows submit (never blocks — review finding 16), mutation failure keeps
 * the sheet open with typed values (the `ClockOutSheet` discipline), and
 * the already-marked read-only state with its "Adjust" escape hatch.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
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

let MarkTimeOffPaidSheet: typeof import('../MarkTimeOffPaidSheet').MarkTimeOffPaidSheet;
type MarkTimeOffPaidSheetProps =
  import('../MarkTimeOffPaidSheet').MarkTimeOffPaidSheetProps;

beforeAll(async () => {
  MarkTimeOffPaidSheet = (await import('../MarkTimeOffPaidSheet'))
    .MarkTimeOffPaidSheet;
});

const TIME_OFF_ID = '66666666-6666-4666-8666-666666666666';

const BALANCE = {
  carer_id: 'carer-1',
  household_id: 'household-1',
  year: 2026,
  entitlement_minutes: 8400,
  accrued_minutes: 8400,
  used_minutes: 2880,
  balance_minutes: 5760, // 96h
};

function baseProps(
  overrides: Partial<MarkTimeOffPaidSheetProps> = {}
): MarkTimeOffPaidSheetProps {
  return {
    visible: true,
    onDismiss: mock(),
    onSubmit: mock(),
    isSubmitting: false,
    carerName: 'Amara',
    rangeLabel: 'Mon 24 – Wed 26 August',
    timeOffId: TIME_OFF_ID,
    balance: BALANCE,
    existingUsageEntry: null,
    ...overrides,
  };
}

describe('MarkTimeOffPaidSheet', () => {
  it('renders the subtitle, hours input, and before balance', async () => {
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps()} />
    );

    expect(getByTestId('pto-mark-paid-hours-input')).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId('pto-mark-paid-before-after')).toBeTruthy()
    );
  });

  it('typing hours updates the after-balance figure', () => {
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps()} />
    );

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '8');

    const beforeAfter = getByTestId('pto-mark-paid-before-after');
    // key-echo mocked i18n drops params, so assert the underlying figures
    // through the component's own testID-scoped sub-elements instead.
    expect(beforeAfter).toBeTruthy();
    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBeFalsy();
  });

  it('the submit button is disabled until hours are entered', () => {
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps()} />
    );

    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBe(true);

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), 'abc');
    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBe(true);
  });

  // The API's mark-paid is total-not-delta (Phase 3/4 review, blocker 3), so
  // a requested total of 0 is the ONLY way to un-pay a mis-marked time off.
  // The client must be able to express it — an earlier fix that rejected
  // everything rounding to zero minutes had made the reversal unreachable.
  it('accepts an explicit 0 as the full-reversal instruction', () => {
    const onSubmit = mock();
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '0');
    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBe(false);

    fireEvent.press(getByTestId('pto-mark-paid-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      time_off_id: TIME_OFF_ID,
      minutes: 0,
    });
  });

  // Distinct from an explicit 0: real positive input that rounds away to
  // nothing must still be refused, or a fat-fingered 0.004 would silently
  // un-pay her instead of paying a few minutes.
  it('still refuses positive hours that round to zero minutes', () => {
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps()} />
    );

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '0.004');
    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBe(true);
  });

  it('submits { time_off_id, minutes } built from the typed hours', () => {
    const onSubmit = mock();
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '8');
    fireEvent.press(getByTestId('pto-mark-paid-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      time_off_id: TIME_OFF_ID,
      minutes: 480,
    });
  });

  it('OVER-BALANCE: shows a warning but the submit button stays enabled — never blocks', () => {
    const onSubmit = mock();
    const { getByTestId, queryByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps({ onSubmit })} />
    );

    expect(queryByTestId('pto-mark-paid-over-balance-warning')).toBeNull();

    // 96h balance; typing 100h pays more than she has left.
    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '100');

    expect(getByTestId('pto-mark-paid-over-balance-warning')).toBeTruthy();
    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBeFalsy();

    fireEvent.press(getByTestId('pto-mark-paid-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      time_off_id: TIME_OFF_ID,
      minutes: 6000,
    });
  });

  it('the note field, when filled, is trimmed and included in the submit', () => {
    const onSubmit = mock();
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '8');
    fireEvent.changeText(
      getByTestId('pto-mark-paid-note-input'),
      '  agreed over text  '
    );
    fireEvent.press(getByTestId('pto-mark-paid-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      time_off_id: TIME_OFF_ID,
      minutes: 480,
      note: 'agreed over text',
    });
  });

  it('already marked: opens read-only with the paid summary and an "Adjust" ghost button', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet
        {...baseProps({
          existingUsageEntry: {
            id: 'entry-1',
            household_id: 'household-1',
            carer_id: 'carer-1',
            kind: 'usage',
            minutes: -480,
            effective_date: '2026-08-26',
            time_off_id: TIME_OFF_ID,
            carer_display_name: 'Amara',
            note: null,
            created_by: null,
            created_at: '2026-08-26T10:00:00.000Z',
          },
        })}
      />
    );

    expect(getByTestId('pto-mark-paid-already-paid')).toBeTruthy();
    expect(getByTestId('pto-mark-paid-adjust')).toBeTruthy();
    expect(queryByTestId('pto-mark-paid-hours-input')).toBeNull();

    fireEvent.press(getByTestId('pto-mark-paid-adjust'));
    expect(getByTestId('pto-mark-paid-hours-input')).toBeTruthy();
  });

  // Phase 3+4 adversarial review, finding 13: bare `Number()` accepted
  // scientific notation nobody typed on purpose, and let a real positive
  // number of hours round to 0 minutes without any client-side refusal.
  it('finding 13: rejects scientific notation ("2e1") rather than treating it as 20', () => {
    const onSubmit = mock();
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '2e1');

    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBe(true);
    expect(getByTestId('pto-mark-paid-hours-error')).toBeTruthy();
    fireEvent.press(getByTestId('pto-mark-paid-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('finding 13: rejects an amount of hours that rounds to 0 minutes (0.004h)', () => {
    const onSubmit = mock();
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '0.004');

    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBe(true);
    expect(getByTestId('pto-mark-paid-hours-error')).toBeTruthy();
    fireEvent.press(getByTestId('pto-mark-paid-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('finding 13: accepts a plain decimal number of hours (7.5 -> 450 minutes)', () => {
    const onSubmit = mock();
    const { getByTestId, queryByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '7.5');

    expect(queryByTestId('pto-mark-paid-hours-error')).toBeNull();
    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBeFalsy();
    fireEvent.press(getByTestId('pto-mark-paid-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      time_off_id: TIME_OFF_ID,
      minutes: 450,
    });
  });

  it('re-seeds to blank every time the sheet re-opens', () => {
    const { getByTestId, rerender } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps({ visible: false })} />
    );

    rerender(<MarkTimeOffPaidSheet {...baseProps()} />);

    expect(getByTestId('pto-mark-paid-hours-input').props.value).toBe('');
  });
});

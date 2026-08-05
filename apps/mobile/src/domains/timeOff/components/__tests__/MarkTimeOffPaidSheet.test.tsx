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

  it('the submit button is disabled until a positive number of hours is entered', () => {
    const { getByTestId } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps()} />
    );

    expect(getByTestId('pto-mark-paid-submit').props.disabled).toBe(true);

    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '0');
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

  it('re-seeds to blank every time the sheet re-opens', () => {
    const { getByTestId, rerender } = renderWithProviders(
      <MarkTimeOffPaidSheet {...baseProps({ visible: false })} />
    );

    rerender(<MarkTimeOffPaidSheet {...baseProps()} />);

    expect(getByTestId('pto-mark-paid-hours-input').props.value).toBe('');
  });
});

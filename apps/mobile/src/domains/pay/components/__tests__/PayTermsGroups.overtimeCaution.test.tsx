/**
 * @module domains/pay/components/__tests__/PayTermsGroups.overtimeCaution
 *
 * R5: a non-blocking caution when overtime terms sit below common floors.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { blankPayTermsFormState } from '@/src/domains/pay/utils/payArrangementForm';
import { PayTermsGroups } from '../PayTermsGroups';

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

const TEST_ID_PREFIX = 'pay-test';
const TODAY = '2026-08-04';

function renderOvertimeGroup(
  patch: Partial<ReturnType<typeof blankPayTermsFormState>>
) {
  const state = { ...blankPayTermsFormState('USD', TODAY), ...patch };
  const utils = render(
    <PayTermsGroups
      testIDPrefix={TEST_ID_PREFIX}
      state={state}
      onChange={() => {}}
      seed={null}
    />
  );
  fireEvent.press(utils.getByTestId(`${TEST_ID_PREFIX}-group-overtime`));
  return utils;
}

describe('PayTermsGroups — overtime floor caution', () => {
  it('shows the caution for 60 hours at 1.1×', () => {
    const { getByTestId } = renderOvertimeGroup({
      overtimeThresholdHoursText: '60',
      overtimeMultiplierText: '1.1',
    });

    expect(
      getByTestId(`${TEST_ID_PREFIX}-overtime-floor-caution`)
    ).toBeTruthy();
  });

  it('does not show the caution for 40 hours at 1.5×', () => {
    const { queryByTestId } = renderOvertimeGroup({
      overtimeThresholdHoursText: '40',
      overtimeMultiplierText: '1.5',
    });

    expect(
      queryByTestId(`${TEST_ID_PREFIX}-overtime-floor-caution`)
    ).toBeNull();
  });

  it('does not show the caution when overtime fields are blank', () => {
    const { queryByTestId } = renderOvertimeGroup({
      overtimeThresholdHoursText: '',
      overtimeMultiplierText: '',
    });

    expect(
      queryByTestId(`${TEST_ID_PREFIX}-overtime-floor-caution`)
    ).toBeNull();
  });
});

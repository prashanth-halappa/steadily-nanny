/**
 * @module domains/pay/components/__tests__/PayTermsGroups.evenSpreadCaveat
 *
 * S10: when daily overtime is set, the weekly-equivalent line is followed by
 * the even-spread caveat. Gate on overtime_daily_threshold_minutes separately
 * from the weekly-equivalent condition (PayChangeSheet fixtures must not break).
 */
import { describe, expect, it, mock } from 'bun:test';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { render } from '@testing-library/react-native';
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

/** Same spine as PayChangeSheet.test's `currentArrangement` — omit `terms`
 * entirely (`null` trips `seededTerms[key]` because `null !== undefined`). */
const baseSeed: PayArrangement = {
  id: 'arr-1',
  household_id: 'hh-1',
  carer_id: 'carer-1',
  rate_minor: 2800,
  bill_rate_minor: null,
  currency: 'USD',
  overtime_threshold_minutes: 2400,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: 3000,
  weekly_equivalent_minor: 154000,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: null,
  valid_from: TODAY,
  valid_to: null,
  carer_display_name: 'Priya',
  note: null,
  created_by: 'parent-1',
  created_at: `${TODAY}T00:00:00.000Z`,
};

function renderGuaranteedGroup(seed: PayArrangement) {
  // `defaultOpen` is true when `guaranteed_minutes_per_week` is set — do NOT
  // press the header (that would toggle the group CLOSED).
  return render(
    <PayTermsGroups
      testIDPrefix={TEST_ID_PREFIX}
      state={blankPayTermsFormState('USD', TODAY)}
      onChange={() => {}}
      seed={seed}
    />
  );
}

describe('PayTermsGroups — even-spread caveat (S10)', () => {
  it('renders the caveat only when daily overtime is set', () => {
    const { getByTestId, queryByTestId } = renderGuaranteedGroup({
      ...baseSeed,
      overtime_daily_threshold_minutes: 480,
    });

    expect(getByTestId(`${TEST_ID_PREFIX}-weekly-equivalent`)).toBeTruthy();
    const caveat = queryByTestId(`${TEST_ID_PREFIX}-weekly-even-spread-caveat`);
    expect(caveat).not.toBeNull();
    expect(caveat?.props.children).toBe('proposal.evenSpreadCaveat');
  });

  it('shows weekly equivalent WITHOUT the caveat when daily OT is unset', () => {
    const { getByTestId, queryByTestId } = renderGuaranteedGroup({
      ...baseSeed,
      overtime_daily_threshold_minutes: null,
    });

    expect(getByTestId(`${TEST_ID_PREFIX}-weekly-equivalent`)).toBeTruthy();
    expect(
      queryByTestId(`${TEST_ID_PREFIX}-weekly-even-spread-caveat`)
    ).toBeNull();
  });

  it('shows neither line when there is no weekly equivalent', () => {
    const { queryByTestId } = renderGuaranteedGroup({
      ...baseSeed,
      weekly_equivalent_minor: null,
      overtime_daily_threshold_minutes: 480,
    });

    expect(queryByTestId(`${TEST_ID_PREFIX}-weekly-equivalent`)).toBeNull();
    expect(
      queryByTestId(`${TEST_ID_PREFIX}-weekly-even-spread-caveat`)
    ).toBeNull();
  });
});

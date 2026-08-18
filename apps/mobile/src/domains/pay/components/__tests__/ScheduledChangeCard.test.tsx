/**
 * @module domains/pay/components/__tests__/ScheduledChangeCard
 *
 * F18 — extracted from `PayArrangementScreen`'s inline block so `MyPayScreen`
 * can render the same card READ-ONLY. `canManage` is the whole gate: true
 * shows Edit/Cancel (the parent's card), false shows neither (the nanny's).
 */
import { describe, expect, it, mock } from 'bun:test';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { fireEvent, render } from '@testing-library/react-native';
import { ScheduledChangeCard } from '../ScheduledChangeCard';

const currentArrangement = {
  id: 'arr-current',
  household_id: 'h1',
  carer_id: 'c1',
  rate_minor: 1850,
  bill_rate_minor: null,
  currency: 'GBP',
  overtime_threshold_minutes: null,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: null,
  valid_from: '2026-04-01',
  carer_display_name: 'Priya',
  note: null,
  created_by: 'parent-1',
  created_at: '2026-04-01T00:00:00.000Z',
} as PayArrangement;

const scheduledArrangement = {
  ...currentArrangement,
  id: 'arr-scheduled',
  rate_minor: 2000,
  valid_from: '2099-01-01',
} as PayArrangement;

describe('ScheduledChangeCard', () => {
  it('canManage=true renders Edit and Cancel', () => {
    const onEdit = mock();
    const onCancel = mock();
    const { getByTestId } = render(
      <ScheduledChangeCard
        arrangement={scheduledArrangement}
        currentArrangement={currentArrangement}
        canManage
        onEdit={onEdit}
        onCancel={onCancel}
      />
    );

    expect(getByTestId('pay-scheduled-change-card')).toBeTruthy();
    expect(getByTestId('pay-scheduled-diff')).toBeTruthy();

    fireEvent.press(getByTestId('pay-scheduled-edit'));
    expect(onEdit).toHaveBeenCalled();

    fireEvent.press(getByTestId('pay-scheduled-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('canManage=false renders neither Edit nor Cancel', () => {
    const { getByTestId, queryByTestId } = render(
      <ScheduledChangeCard
        arrangement={scheduledArrangement}
        currentArrangement={currentArrangement}
        canManage={false}
      />
    );

    expect(getByTestId('pay-scheduled-change-card')).toBeTruthy();
    expect(queryByTestId('pay-scheduled-edit')).toBeNull();
    expect(queryByTestId('pay-scheduled-cancel')).toBeNull();
  });

  it('renders cancelError inline when passed', () => {
    const { getByTestId, getByText } = render(
      <ScheduledChangeCard
        arrangement={scheduledArrangement}
        currentArrangement={currentArrangement}
        canManage
        onEdit={() => {}}
        onCancel={() => {}}
        cancelError="scheduledChange.cancelFailed"
      />
    );

    expect(getByTestId('pay-scheduled-cancel-error')).toBeTruthy();
    expect(getByText('scheduledChange.cancelFailed')).toBeTruthy();
  });

  it('no cancelError: renders no inline error', () => {
    const { queryByTestId } = render(
      <ScheduledChangeCard
        arrangement={scheduledArrangement}
        currentArrangement={currentArrangement}
        canManage
        onEdit={() => {}}
        onCancel={() => {}}
      />
    );

    expect(queryByTestId('pay-scheduled-cancel-error')).toBeNull();
  });
});

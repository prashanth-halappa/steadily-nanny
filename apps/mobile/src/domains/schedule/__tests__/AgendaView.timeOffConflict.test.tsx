/**
 * @module domains/schedule/__tests__/AgendaView.timeOffConflict.test
 *
 * D77a (docs/DEFECT-LOG.md) — a booked shift for a carer who is on accepted
 * time off across it must not render as an ordinary confirmed row with
 * nothing pointing out the collision. Pattern B (mock rendering,
 * docs/09-TESTING.md §5), same fixture shape as `AgendaView.names.test.tsx`.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { render } from '@testing-library/react-native';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: () => {} }),
  router: { push: () => {}, replace: () => {}, back: () => {} },
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_A_ID = '22222222-2222-4222-8222-222222222222';
const NANNY_B_ID = '33333333-3333-4333-8333-333333333333';

mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({ data: [] }),
}));
mock.module('@/src/hooks/queries/useChildren', () => ({
  useChildren: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
  useHouseholdCarers: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
  useCreateParentCover: () => ({
    mutateAsync: async () => {},
    isPending: false,
  }),
}));
mock.module('@/src/hooks/mutations/useRemoveParentCover', () => ({
  useRemoveParentCover: () => ({
    mutateAsync: async () => {},
    isPending: false,
  }),
}));
mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
  useCanWriteHousehold: () => ({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  }),
}));

let AgendaView: typeof import('../components/AgendaView').AgendaView;

beforeAll(async () => {
  AgendaView = (await import('../components/AgendaView')).AgendaView;
});

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_A_ID,
    starts_at: '2026-08-21T13:00:00.000Z',
    ends_at: '2026-08-21T21:00:00.000Z',
    timezone: 'UTC',
    local_date: '2026-08-21',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift-1@steadily',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

function makeTimeOff(overrides: Partial<CarerTimeOff> = {}): CarerTimeOff {
  return {
    id: 'timeoff-1',
    user_id: NANNY_A_ID,
    starts_at: '2026-08-21T00:00:00.000Z',
    ends_at: '2026-08-24T00:00:00.000Z',
    all_day: true,
    message: 'Mexico',
    kind: 'personal',
    status: 'confirmed',
    ical_uid: 'timeoff-1@steadily',
    sequence: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as CarerTimeOff;
}

describe('AgendaView time-off conflict badge (D77a)', () => {
  it('flags a booked shift whose own carer has accepted time off across it', () => {
    const { getByTestId, getByText } = render(
      <AgendaView
        shifts={[makeShift()]}
        timeOff={[makeTimeOff()]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-21']}
      />
    );

    expect(getByTestId('schedule-shift-timeoff-conflict-shift-1')).toBeTruthy();
    // `react-i18next` is key-echo mocked (bun.setup.ts) — asserting the KEY
    // is the stable thing to assert here, and it also pins down that this
    // is its own dedicated string, not the day-band "shifts.awayBand" key
    // reused, which could read as the shift, the carer, or a broken row
    // (D77a).
    expect(getByText('shifts.timeOffConflict')).toBeTruthy();
  });

  it('does not flag a shift whose carer has no overlapping time off', () => {
    const { queryByTestId } = render(
      <AgendaView
        shifts={[makeShift()]}
        timeOff={[]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-21']}
      />
    );

    expect(queryByTestId('schedule-shift-timeoff-conflict-shift-1')).toBeNull();
  });

  it('does not flag a shift when the time off belongs to a different carer', () => {
    const { queryByTestId } = render(
      <AgendaView
        shifts={[makeShift({ carer_id: NANNY_B_ID })]}
        timeOff={[makeTimeOff()]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-21']}
      />
    );

    expect(queryByTestId('schedule-shift-timeoff-conflict-shift-1')).toBeNull();
  });
});

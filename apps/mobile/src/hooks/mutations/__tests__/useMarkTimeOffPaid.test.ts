/**
 * @module hooks/mutations/__tests__/useMarkTimeOffPaid.test
 * Marking time off paid must invalidate the balance + ledger caches for
 * that (household, carer, year) AND the household's time-off list — the
 * paid marker on `household-time-off.tsx` reads from that list
 * (TIER0-CX-SPEC.md §5.1).
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const TIME_OFF_ID = '66666666-6666-4666-8666-666666666666';
const YEAR = 2026;

const markPaidMock = mock(() =>
  Promise.resolve({
    id: '77777777-7777-4777-8777-777777777777',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    kind: 'usage',
    minutes: -480,
    effective_date: '2026-08-01',
    time_off_id: TIME_OFF_ID,
    carer_display_name: 'Amara',
    note: null,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
  })
);

mock.module('@/src/api/endpoints/pto', () => ({
  ptoApi: { markPaid: markPaidMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useMarkTimeOffPaid: typeof import('../useMarkTimeOffPaid').useMarkTimeOffPaid;

beforeAll(async () => {
  useMarkTimeOffPaid = (await import('../useMarkTimeOffPaid'))
    .useMarkTimeOffPaid;
});

describe('useMarkTimeOffPaid', () => {
  it('marks paid and invalidates balance + ledger + the household time-off list', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useMarkTimeOffPaid(HOUSEHOLD_ID, CARER_ID, YEAR)
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        time_off_id: TIME_OFF_ID,
        minutes: 480,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(markPaidMock).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      time_off_id: TIME_OFF_ID,
      minutes: 480,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.pto.balance(HOUSEHOLD_ID, CARER_ID, YEAR),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.pto.ledger(HOUSEHOLD_ID, CARER_ID, YEAR),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timeOff.forHousehold(HOUSEHOLD_ID),
    });
  });
});

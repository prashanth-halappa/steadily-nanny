/**
 * @module hooks/mutations/__tests__/useClockOut.test
 * Covers: the clock-out mutation passes entryId + the rest of the body
 * through to timeEntryApi.clockOut, and resolves on success.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const clockOutMock = mock((entryId: string, _input: unknown) =>
  Promise.resolve({ id: entryId, status: 'submitted' })
);
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: { clockOut: clockOutMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useClockOut: typeof import('../useClockOut').useClockOut;

beforeAll(async () => {
  useClockOut = (await import('../useClockOut')).useClockOut;
});

describe('useClockOut', () => {
  it('splits entryId out of the mutation variables and forwards the rest as the body', async () => {
    const { result } = renderHookWithProviders(() => useClockOut());

    await act(async () => {
      await result.current.mutateAsync({
        entryId: 'entry-1',
        break_minutes: 30,
        note: 'done',
      });
    });

    expect(clockOutMock).toHaveBeenCalledWith('entry-1', {
      break_minutes: 30,
      note: 'done',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

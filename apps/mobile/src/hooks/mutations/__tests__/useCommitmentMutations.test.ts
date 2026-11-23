/**
 * @module hooks/mutations/__tests__/useCommitmentMutations.test
 * Create + delete must invalidate the household-wide commitments list too:
 * it feeds uncovered-care detection on the Schedule agenda and Today.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '77777777-7777-4777-8777-777777777777';
const CHILD_ID = '88888888-8888-4888-8888-888888888888';

const createMock = mock(() =>
  Promise.resolve({ id: '22222222-2222-4222-8222-222222222222' })
);
const removeMock = mock(() => Promise.resolve(undefined));

mock.module('@/src/api/endpoints/commitments', () => ({
  commitmentApi: { create: createMock, remove: removeMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useCreateCommitment: typeof import('../useCreateCommitment').useCreateCommitment;
let useDeleteCommitment: typeof import('../useDeleteCommitment').useDeleteCommitment;

beforeAll(async () => {
  useCreateCommitment = (await import('../useCreateCommitment'))
    .useCreateCommitment;
  useDeleteCommitment = (await import('../useDeleteCommitment'))
    .useDeleteCommitment;
});

describe('commitment mutations invalidate the household-wide list', () => {
  it('create', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useCreateCommitment(HOUSEHOLD_ID, CHILD_ID)
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync({} as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.commitments.byHousehold(HOUSEHOLD_ID),
    });
  });

  it('delete', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useDeleteCommitment(HOUSEHOLD_ID, CHILD_ID)
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync('22222222-2222-4222-8222-222222222222');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.commitments.byHousehold(HOUSEHOLD_ID),
    });
  });
});

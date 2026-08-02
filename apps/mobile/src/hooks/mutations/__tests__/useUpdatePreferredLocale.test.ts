/**
 * @module hooks/mutations/__tests__/useUpdatePreferredLocale.test
 * Covers: forwards `{ preferred_locale }` to `userApi.updatePreferredLocale`,
 * invalidates the user query subtree on success, and surfaces a failure via
 * the standard error toast.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const updatePreferredLocaleMock = mock((input: { preferred_locale: string }) =>
  Promise.resolve({
    user_id: 'user-1',
    name: 'Sam',
    city: null,
    country: null,
    preferred_locale: input.preferred_locale,
  })
);
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/user', () => ({
  userApi: { updatePreferredLocale: updatePreferredLocaleMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useUpdatePreferredLocale: typeof import('../useUpdatePreferredLocale').useUpdatePreferredLocale;

beforeAll(async () => {
  useUpdatePreferredLocale = (await import('../useUpdatePreferredLocale'))
    .useUpdatePreferredLocale;
});

describe('useUpdatePreferredLocale', () => {
  it('forwards { preferred_locale } to userApi.updatePreferredLocale', async () => {
    const { result } = renderHookWithProviders(() =>
      useUpdatePreferredLocale()
    );

    await act(async () => {
      await result.current.mutateAsync({ preferred_locale: 'es' });
    });

    expect(updatePreferredLocaleMock).toHaveBeenCalledWith({
      preferred_locale: 'es',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates the user query subtree on success', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useUpdatePreferredLocale()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ preferred_locale: 'en' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.user.all,
    });
  });

  it('shows the generic error message on failure', async () => {
    updatePreferredLocaleMock.mockImplementationOnce(() =>
      Promise.reject(new Error('boom'))
    );
    const { result } = renderHookWithProviders(() =>
      useUpdatePreferredLocale()
    );

    await act(async () => {
      await expect(
        result.current.mutateAsync({ preferred_locale: 'es' })
      ).rejects.toThrow('boom');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:unknown');
  });
});

/**
 * @module hooks/mutations/__tests__/useUpdateTimeSettings.test
 * D29 — invalidate user profile cache after time-settings PATCH.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const updateTimeSettingsMock = mock(() =>
  Promise.resolve({
    user_id: 'user-1',
    name: 'Sam',
    city: null,
    country: null,
    timezone: 'Europe/London',
    week_starts_on: 0,
  })
);

mock.module('@/src/api/endpoints/user', () => ({
  userApi: { updateTimeSettings: updateTimeSettingsMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useUpdateTimeSettings: typeof import('../useUpdateTimeSettings').useUpdateTimeSettings;

beforeAll(async () => {
  useUpdateTimeSettings = (await import('../useUpdateTimeSettings'))
    .useUpdateTimeSettings;
});

describe('useUpdateTimeSettings', () => {
  it('invalidates queryKeys.user.all on success', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useUpdateTimeSettings()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        timezone: 'Europe/London',
        week_starts_on: 0,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateTimeSettingsMock).toHaveBeenCalledWith({
      timezone: 'Europe/London',
      week_starts_on: 0,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.user.all,
    });
  });
});

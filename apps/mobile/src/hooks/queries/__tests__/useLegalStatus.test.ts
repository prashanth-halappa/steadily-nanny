/**
 * @module hooks/queries/__tests__/useLegalStatus.test
 * Covers: disabled when `enabled: false`, fetches and caches under
 * `queryKeys.legal.status()` when `enabled: true`, surfaces errors.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  CURRENT_LEGAL_VERSION,
  type LegalStatus,
} from '@steadily-nanny/shared-types';
import { waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const STATUS: LegalStatus = {
  currentVersion: CURRENT_LEGAL_VERSION,
  acceptedVersion: null,
  acceptedAt: null,
  needsAcceptance: true,
};

const getStatusMock = mock(() => Promise.resolve(STATUS));

mock.module('@/src/api/endpoints/legal', () => ({
  legalApi: { getStatus: getStatusMock },
}));

let useLegalStatus: typeof import('../useLegalStatus').useLegalStatus;

beforeEach(async () => {
  useLegalStatus = (await import('../useLegalStatus')).useLegalStatus;
  getStatusMock.mockReset();
  getStatusMock.mockImplementation(() => Promise.resolve(STATUS));
});

describe('useLegalStatus', () => {
  it('does not fetch when enabled is false', () => {
    const { result } = renderHookWithProviders(() =>
      useLegalStatus({ enabled: false })
    );

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(getStatusMock).not.toHaveBeenCalled();
  });

  it('fetches and caches under queryKeys.legal.status() when enabled is true', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHookWithProviders(
      () => useLegalStatus({ enabled: true }),
      { queryClient }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getStatusMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(STATUS);
    expect(queryClient.getQueryData(queryKeys.legal.status())).toEqual(STATUS);
  });

  it('surfaces error state when legalApi.getStatus rejects', async () => {
    getStatusMock.mockImplementationOnce(() =>
      Promise.reject(new Error('Network failure'))
    );

    const { result } = renderHookWithProviders(() =>
      useLegalStatus({ enabled: true })
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network failure');
  });
});

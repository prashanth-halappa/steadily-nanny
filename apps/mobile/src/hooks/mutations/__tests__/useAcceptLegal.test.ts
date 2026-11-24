/**
 * @module hooks/mutations/__tests__/useAcceptLegal.test
 * Covers: sends CURRENT_LEGAL_VERSION + platform + appVersion, writes the
 * returned LegalStatus into the query cache on success, invalidates
 * `queryKeys.legal.status()` on error (so a 409 refetches the real status).
 */
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import type { LegalStatus } from '@steadily-nanny/shared-types';
import { CURRENT_LEGAL_VERSION } from '@steadily-nanny/shared-types';
import { QueryClient } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { appIdentity } from '@/src/config/appIdentity';
import { renderHookWithProviders } from '@/src/test-utils';

// The shared test harness defaults to `gcTime: 0`, which garbage-collects an
// unobserved query immediately after `setQueryData`. A non-zero gcTime lets
// the test read the seeded cache back out after the mutation settles.
function buildQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 5000 },
      mutations: { retry: false },
    },
  });
}

const ACCEPTED_STATUS: LegalStatus = {
  currentVersion: CURRENT_LEGAL_VERSION,
  acceptedVersion: CURRENT_LEGAL_VERSION,
  acceptedAt: '2026-11-24T12:00:00.000Z',
  needsAcceptance: false,
};

const acceptMock = mock(() => Promise.resolve(ACCEPTED_STATUS));

mock.module('@/src/api/endpoints/legal', () => ({
  legalApi: { accept: acceptMock },
}));

let useAcceptLegal: typeof import('../useAcceptLegal').useAcceptLegal;

beforeAll(async () => {
  useAcceptLegal = (await import('../useAcceptLegal')).useAcceptLegal;
});

beforeEach(() => {
  acceptMock.mockReset();
  acceptMock.mockImplementation(() => Promise.resolve(ACCEPTED_STATUS));
});

describe('useAcceptLegal', () => {
  it('sends CURRENT_LEGAL_VERSION, platform, and appVersion and writes the cache on success', async () => {
    const queryClient = buildQueryClient();
    const { result } = renderHookWithProviders(() => useAcceptLegal(), {
      queryClient,
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(acceptMock).toHaveBeenCalledTimes(1);
    expect(acceptMock).toHaveBeenCalledWith({
      version: CURRENT_LEGAL_VERSION,
      platform: 'ios',
      appVersion: appIdentity.version,
    });
    expect(queryClient.getQueryData(queryKeys.legal.status())).toEqual(
      ACCEPTED_STATUS
    );
    queryClient.clear();
  });

  it('invalidates queryKeys.legal.status() on error (e.g. 409 version mismatch)', async () => {
    const mismatchError = Object.assign(new Error('Version mismatch'), {
      response: {
        status: 409,
        data: {
          error: {
            code: 'CONFLICT',
            metadata: { reason: 'LEGAL_VERSION_MISMATCH' },
          },
        },
      },
    });
    acceptMock.mockImplementationOnce(() => Promise.reject(mismatchError));

    const { result, queryClient } = renderHookWithProviders(() =>
      useAcceptLegal()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBe(mismatchError);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.legal.status(),
    });
  });
});

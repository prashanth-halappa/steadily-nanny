/**
 * @module api/endpoints/__tests__/legal.test
 * Covers: URL/verb, request validation, response-envelope unwrap + Zod
 * validation for legalApi.getStatus and legalApi.accept.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { CURRENT_LEGAL_VERSION } from '@steadily-nanny/shared-types';

let legalApi: typeof import('../legal').legalApi;
let apiClient: {
  get: ReturnType<typeof mock>;
  post: ReturnType<typeof mock>;
};

const acceptedStatus = {
  currentVersion: CURRENT_LEGAL_VERSION,
  acceptedVersion: CURRENT_LEGAL_VERSION,
  acceptedAt: '2026-11-24T12:00:00.000Z',
  needsAcceptance: false,
};

const pendingStatus = {
  currentVersion: CURRENT_LEGAL_VERSION,
  acceptedVersion: null,
  acceptedAt: null,
  needsAcceptance: true,
};

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
      post: mock(() => Promise.resolve({})),
      put: mock(() => Promise.resolve({})),
      patch: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
  }));

  const mod = await import('../legal');
  legalApi = mod.legalApi;
  apiClient = (await import('@/src/api/client')).apiClient as unknown as {
    get: ReturnType<typeof mock>;
    post: ReturnType<typeof mock>;
  };
});

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.post.mockReset();
});

describe('legalApi.getStatus', () => {
  it('GETs /v1/legal/acceptance and returns the parsed status', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: pendingStatus },
    });

    const result = await legalApi.getStatus();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/legal/acceptance');
    expect(result).toEqual(pendingStatus);
  });

  it('rejects a malformed response payload', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          currentVersion: CURRENT_LEGAL_VERSION,
          acceptedVersion: null,
          // missing acceptedAt and needsAcceptance
        },
      },
    });

    await expect(legalApi.getStatus()).rejects.toThrow();
  });

  it('propagates API errors', async () => {
    apiClient.get.mockRejectedValue(new Error('Network down'));

    await expect(legalApi.getStatus()).rejects.toThrow('Network down');
  });
});

describe('legalApi.accept', () => {
  it('POSTs /v1/legal/acceptance with the body and returns the parsed status', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: acceptedStatus },
    });

    const body = {
      version: CURRENT_LEGAL_VERSION,
      platform: 'ios' as const,
      appVersion: '1.0.0',
    };
    const result = await legalApi.accept(body);

    expect(apiClient.post).toHaveBeenCalledWith('/v1/legal/acceptance', body);
    expect(result).toEqual(acceptedStatus);
  });

  it('accepts a body with optional platform and appVersion omitted', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: acceptedStatus },
    });

    const result = await legalApi.accept({ version: CURRENT_LEGAL_VERSION });

    expect(apiClient.post).toHaveBeenCalledWith('/v1/legal/acceptance', {
      version: CURRENT_LEGAL_VERSION,
    });
    expect(result).toEqual(acceptedStatus);
  });

  it('rejects a malformed response payload', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { needsAcceptance: 'not-a-boolean' } },
    });

    await expect(
      legalApi.accept({ version: CURRENT_LEGAL_VERSION })
    ).rejects.toThrow();
  });

  it('rejects an invalid request body without calling the API', async () => {
    await expect(legalApi.accept({ version: '' })).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('propagates 409 conflict errors from the API', async () => {
    const conflictError = Object.assign(new Error('Conflict'), {
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
    apiClient.post.mockRejectedValue(conflictError);

    await expect(legalApi.accept({ version: '2020-01-01' })).rejects.toBe(
      conflictError
    );
  });
});

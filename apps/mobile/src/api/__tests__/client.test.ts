import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// Capture the interceptor callbacks by mocking axios before importing client.
type Rejector = (err: unknown) => Promise<unknown>;
let requestFulfilled: ((config: unknown) => unknown) | undefined;
let responseRejected: Rejector | undefined;

const retryFn = mock((config: unknown) =>
  Promise.resolve({ data: { retried: true }, config })
);

const fakeInstance = Object.assign(retryFn, {
  interceptors: {
    request: {
      use: (f: (config: unknown) => unknown) => {
        requestFulfilled = f;
      },
    },
    response: {
      use: (_f: unknown, r: Rejector) => {
        responseRejected = r;
      },
    },
  },
});

class FakeAxiosError extends Error {
  code?: string;
  config?: unknown;
  constructor(message?: string, code?: string, config?: unknown) {
    super(message);
    this.code = code;
    this.config = config;
  }
}

const axiosDefault = { create: () => fakeInstance, AxiosError: FakeAxiosError };
mock.module('axios', () => ({
  default: axiosDefault,
  AxiosError: FakeAxiosError,
}));

let client: typeof import('../client');

beforeAll(async () => {
  client = await import('../client');
});

beforeEach(() => {
  client.reset401Handler();
  client.clearAuthToken();
});

describe('api client interceptors', () => {
  it('rejects tokenless /v1 requests locally', async () => {
    const config = { url: '/v1/users/me', headers: {} };
    await expect(
      Promise.resolve(requestFulfilled?.(config))
    ).rejects.toBeInstanceOf(FakeAxiosError);
  });

  it('engages the gating handler on a 402 PAYWALL_REQUIRED', async () => {
    const onForbidden = mock((_code?: string) => {});
    client.setOnForbiddenHandler(onForbidden);
    const err = {
      response: { status: 402, data: { error: { code: 'PAYWALL_REQUIRED' } } },
      config: {},
    };
    await expect(responseRejected?.(err)).rejects.toBe(err);
    expect(onForbidden).toHaveBeenCalledWith('PAYWALL_REQUIRED');
  });

  it('engages the gating handler on a 403 PAYWALL_REQUIRED', async () => {
    const onForbidden = mock((_code?: string) => {});
    client.setOnForbiddenHandler(onForbidden);
    const err = {
      response: { status: 403, data: { error: { code: 'PAYWALL_REQUIRED' } } },
      config: {},
    };
    await expect(responseRejected?.(err)).rejects.toBe(err);
    expect(onForbidden).toHaveBeenCalledWith('PAYWALL_REQUIRED');
  });

  it('engages the gating handler on a 429 USAGE_LIMIT_EXCEEDED (not retry-after)', async () => {
    const onForbidden = mock((_code?: string) => {});
    client.setOnForbiddenHandler(onForbidden);
    const err = {
      response: {
        status: 429,
        headers: { 'retry-after': '5' },
        data: { error: { code: 'USAGE_LIMIT_EXCEEDED' } },
      },
      config: {},
    };
    await expect(responseRejected?.(err)).rejects.toBe(err);
    expect(onForbidden).toHaveBeenCalledWith('USAGE_LIMIT_EXCEEDED');
    // A gating 429 goes to the handler, NOT the retry-after annotation path.
    const annotated = err as { retryAfter?: number; isRateLimited?: boolean };
    expect(annotated.retryAfter).toBeUndefined();
    expect(annotated.isRateLimited).toBeUndefined();
  });

  it('annotates retry-after on a plain 429 RATE_LIMITED (no handler)', async () => {
    const onForbidden = mock((_code?: string) => {});
    client.setOnForbiddenHandler(onForbidden);
    const err = {
      response: {
        status: 429,
        headers: { 'retry-after': '2' },
        data: { error: { code: 'RATE_LIMITED' } },
      },
      config: {},
    };
    await expect(responseRejected?.(err)).rejects.toMatchObject({
      retryAfter: 2000,
      isRateLimited: true,
    });
    expect(onForbidden).not.toHaveBeenCalled();
  });

  it('does NOT engage the gating handler on a non-gating 403 FORBIDDEN', async () => {
    const onForbidden = mock((_code?: string) => {});
    client.setOnForbiddenHandler(onForbidden);
    const err = {
      response: { status: 403, data: { error: { code: 'FORBIDDEN' } } },
      config: {},
    };
    await expect(responseRejected?.(err)).rejects.toBe(err);
    expect(onForbidden).not.toHaveBeenCalled();
  });

  it('refreshes the token and retries once on a current-session 401', async () => {
    client.updateAuthToken('tok');
    const refreshToken = mock(async () => 'newtok');
    const onUnauthorized = mock(async () => {});
    client.configureAuthHandlers({ refreshToken, onUnauthorized });
    const config = { headers: { Authorization: 'Bearer tok' } };
    const err = { response: { status: 401 }, config };

    const result = (await responseRejected?.(err)) as {
      data: { retried: boolean };
    };
    expect(refreshToken).toHaveBeenCalled();
    expect(retryFn).toHaveBeenCalled();
    expect(result.data.retried).toBe(true);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('signs out when the refresh fails on a current-session 401', async () => {
    client.updateAuthToken('tok');
    const refreshToken = mock(async () => null);
    const onUnauthorized = mock(async () => {});
    client.configureAuthHandlers({ refreshToken, onUnauthorized });
    const config = { headers: { Authorization: 'Bearer tok' } };
    const err = { response: { status: 401 }, config };

    await expect(responseRejected?.(err)).rejects.toBe(err);
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it('ignores a stale 401 whose token is not the current session token', async () => {
    client.updateAuthToken('current');
    const onUnauthorized = mock(async () => {});
    client.configureAuthHandlers({
      refreshToken: async () => 'x',
      onUnauthorized,
    });
    const err = {
      response: { status: 401 },
      config: { headers: { Authorization: 'Bearer stale' } },
    };
    await expect(responseRejected?.(err)).rejects.toBe(err);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

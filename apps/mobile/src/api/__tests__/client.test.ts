import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { appIdentity } from '@/src/config/appIdentity';

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

let capturedCreateConfig: { headers?: Record<string, unknown> } | undefined;
const axiosDefault = {
  create: (config: { headers?: Record<string, unknown> }) => {
    capturedCreateConfig = config;
    return fakeInstance;
  },
  AxiosError: FakeAxiosError,
};
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

describe('api client instance', () => {
  it('carries the app version headers from appIdentity (F-B11-5)', () => {
    expect(capturedCreateConfig?.headers).toMatchObject({
      'X-App-Version': appIdentity.version,
      'X-App-Runtime-Version': appIdentity.runtimeVersion,
    });
  });
});

describe('api client interceptors', () => {
  it('rejects tokenless /v1 requests locally', async () => {
    const config = { url: '/v1/users/me', headers: {} };
    await expect(
      Promise.resolve(requestFulfilled?.(config))
    ).rejects.toBeInstanceOf(FakeAxiosError);
  });

  it('annotates retry-after on a 429 RATE_LIMITED', async () => {
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
  });

  it('defaults retry-after to 60s on a 429 with no header', async () => {
    const err = {
      response: { status: 429, headers: {}, data: {} },
      config: {},
    };
    await expect(responseRejected?.(err)).rejects.toMatchObject({
      retryAfter: 60000,
      isRateLimited: true,
    });
  });

  it('passes through a plain 403 FORBIDDEN unmodified', async () => {
    const err = {
      response: { status: 403, data: { error: { code: 'FORBIDDEN' } } },
      config: {},
    };
    await expect(responseRejected?.(err)).rejects.toBe(err);
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

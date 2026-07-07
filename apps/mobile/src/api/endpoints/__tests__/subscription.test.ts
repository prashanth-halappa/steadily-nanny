import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let subscriptionApi: any;
let apiClient: any;

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

  const mod = await import('../subscription');
  subscriptionApi = mod.subscriptionApi;

  const clientMod = await import('@/src/api/client');
  apiClient = clientMod.apiClient;
});

describe('subscriptionApi.getStatus', () => {
  beforeEach(() => {
    (apiClient.get as any).mockReset?.();
  });

  it('GETs /v1/subscription/status and returns the validated status', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: {
        data: { tier: 'pro', expiresAt: '2030-01-01', betaAllPro: false },
      },
    });

    const result = await subscriptionApi.getStatus();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/subscription/status');
    expect(result.tier).toBe('pro');
    expect(result.expiresAt).toBe('2030-01-01');
  });

  it('accepts a minimal free-tier status', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: { data: { tier: 'free' } },
    });

    const result = await subscriptionApi.getStatus();
    expect(result.tier).toBe('free');
  });

  it('throws when the response carries an unknown tier', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: { data: { tier: 'platinum' } },
    });

    await expect(subscriptionApi.getStatus()).rejects.toThrow();
  });

  it('propagates API errors', async () => {
    (apiClient.get as any).mockRejectedValue(new Error('status failed'));

    await expect(subscriptionApi.getStatus()).rejects.toThrow('status failed');
  });
});

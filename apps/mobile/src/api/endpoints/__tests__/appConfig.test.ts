import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let appConfigApi: any;
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

  const mod = await import('../appConfig');
  appConfigApi = mod.appConfigApi;

  const clientMod = await import('@/src/api/client');
  apiClient = clientMod.apiClient;
});

const validStatus = {
  status: 'ok',
  update: {
    required: false,
    available: false,
    currentVersion: '1.0.0',
    latestVersion: '1.0.0',
    minimumVersion: '1.0.0',
    storeUrl: 'https://example.com/app',
  },
  announcements: [],
};

describe('appConfigApi', () => {
  beforeEach(() => {
    (apiClient.get as any).mockReset?.();
  });

  describe('getStatus', () => {
    it('GETs /app/status with version + platform headers and a fail-fast timeout', async () => {
      (apiClient.get as any).mockResolvedValue({ data: validStatus });

      const result = await appConfigApi.getStatus('1.2.3', 'ios');

      expect(apiClient.get).toHaveBeenCalledWith(
        '/app/status',
        expect.objectContaining({
          headers: {
            'x-app-version': '1.2.3',
            'x-app-platform': 'ios',
          },
          timeout: 3000,
        })
      );
      expect(result.status).toBe('ok');
    });

    it('reads the response body directly (not the .data.data envelope)', async () => {
      (apiClient.get as any).mockResolvedValue({ data: validStatus });

      const result = await appConfigApi.getStatus('1.0.0', 'android');

      expect(result).toEqual(validStatus);
    });

    it('parses announcements and the betaAllPro override', async () => {
      (apiClient.get as any).mockResolvedValue({
        data: {
          ...validStatus,
          betaAllPro: true,
          announcements: [
            {
              id: 'a1',
              title: 'Heads up',
              body: 'Scheduled maintenance tonight',
              type: 'warning',
              dismissible: true,
            },
          ],
        },
      });

      const result = await appConfigApi.getStatus('1.0.0', 'ios');

      expect(result.betaAllPro).toBe(true);
      expect(result.announcements[0].type).toBe('warning');
    });

    it('throws when the response fails validation (unknown status)', async () => {
      (apiClient.get as any).mockResolvedValue({
        data: { status: 'not-a-status', announcements: [] },
      });

      await expect(appConfigApi.getStatus('1.0.0', 'ios')).rejects.toThrow();
    });

    it('propagates API errors', async () => {
      (apiClient.get as any).mockRejectedValue(new Error('Network timeout'));

      await expect(appConfigApi.getStatus('1.0.0', 'ios')).rejects.toThrow(
        'Network timeout'
      );
    });
  });
});

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let notificationsApi: any;
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

  const mod = await import('../notifications');
  notificationsApi = mod.notificationsApi;

  const clientMod = await import('@/src/api/client');
  apiClient = clientMod.apiClient;
});

describe('notificationsApi.registerDevice', () => {
  const device = {
    deviceId: 'inst-1',
    platform: 'ios',
    notificationPermission: 'granted',
    timezone: 'Europe/Lisbon',
    appVersion: '1.2.0',
  };

  beforeEach(() => {
    (apiClient.post as any).mockReset?.();
  });

  it('POSTs /v1/notifications/devices with the validated payload', async () => {
    (apiClient.post as any).mockResolvedValue({ data: {} });

    await notificationsApi.registerDevice(device);

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/notifications/devices',
      device
    );
  });

  it('omits an absent expoPushToken', async () => {
    (apiClient.post as any).mockResolvedValue({ data: {} });

    const minimal = {
      deviceId: 'd2',
      platform: 'android',
      notificationPermission: 'provisional',
    };
    await notificationsApi.registerDevice(minimal);

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/notifications/devices',
      minimal
    );
  });

  it('throws on an invalid platform without calling the API', async () => {
    await expect(
      notificationsApi.registerDevice({ ...device, platform: 'windows' })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('rejects the (unsupported) undetermined permission state', async () => {
    await expect(
      notificationsApi.registerDevice({
        ...device,
        notificationPermission: 'undetermined',
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('propagates API errors', async () => {
    (apiClient.post as any).mockRejectedValue(new Error('save failed'));

    await expect(notificationsApi.registerDevice(device)).rejects.toThrow(
      'save failed'
    );
  });

  // D21 — mirrors RegisterDeviceSchema's `.min(1)` on these optional string
  // fields (apps/api/src/domains/notification/schemas.ts) so an empty string
  // fails locally instead of only at the API.

  it('rejects an empty expoPushToken without calling the API', async () => {
    await expect(
      notificationsApi.registerDevice({ ...device, expoPushToken: '' })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('rejects an empty timezone without calling the API', async () => {
    await expect(
      notificationsApi.registerDevice({ ...device, timezone: '' })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('rejects an empty appVersion without calling the API', async () => {
    await expect(
      notificationsApi.registerDevice({ ...device, appVersion: '' })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('notificationsApi prefs', () => {
  const prefs = {
    disabledTypes: [] as string[],
    quietHoursEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: 'UTC',
  };

  beforeEach(() => {
    (apiClient.get as any).mockReset?.();
    (apiClient.patch as any).mockReset?.();
  });

  it('GETs /v1/notifications/prefs and returns prefs', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: { data: { prefs } },
    });

    const result = await notificationsApi.getPrefs();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/notifications/prefs');
    expect(result).toEqual(prefs);
  });

  it('PATCHes /v1/notifications/prefs with a validated body', async () => {
    const updated = {
      ...prefs,
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'America/Los_Angeles',
    };
    (apiClient.patch as any).mockResolvedValue({
      data: { data: { prefs: updated } },
    });

    const result = await notificationsApi.updatePrefs({
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'America/Los_Angeles',
    });

    expect(apiClient.patch).toHaveBeenCalledWith('/v1/notifications/prefs', {
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'America/Los_Angeles',
    });
    expect(result.timezone).toBe('America/Los_Angeles');
  });

  it('rejects an invalid IANA timezone without calling the API', async () => {
    await expect(
      notificationsApi.updatePrefs({ timezone: 'Not/A_Zone' })
    ).rejects.toThrow();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let userApi: any;
let apiClient: any;

beforeAll(async () => {
  // 1. mock.module() FIRST — replace the integrator-owned client seam.
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
      post: mock(() => Promise.resolve({})),
      put: mock(() => Promise.resolve({})),
      patch: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
  }));

  // 2. Dynamic imports AFTER the mock is registered.
  const mod = await import('../user');
  userApi = mod.userApi;

  const clientMod = await import('@/src/api/client');
  apiClient = clientMod.apiClient;
});

describe('userApi', () => {
  beforeEach(() => {
    (apiClient.get as any).mockReset?.();
    (apiClient.post as any).mockReset?.();
    (apiClient.put as any).mockReset?.();
    (apiClient.patch as any).mockReset?.();
    (apiClient.delete as any).mockReset?.();
  });

  describe('getProfile', () => {
    const validProfile = {
      user_id: 'user-123',
      name: 'Jordan',
      city: 'Lisbon',
      country: 'Portugal',
      additional_data: null,
    };

    it('GETs /v1/users/me and returns the validated profile', async () => {
      (apiClient.get as any).mockResolvedValue({
        data: { data: validProfile },
      });

      const result = await userApi.getProfile();

      expect(apiClient.get).toHaveBeenCalledWith('/v1/users/me');
      expect(result.user_id).toBe('user-123');
      expect(result.name).toBe('Jordan');
    });

    it('accepts null display fields', async () => {
      (apiClient.get as any).mockResolvedValue({
        data: {
          data: { user_id: 'u1', name: null, city: null, country: null },
        },
      });

      const result = await userApi.getProfile();

      expect(result.user_id).toBe('u1');
      expect(result.name).toBeNull();
    });

    it('throws when the response fails validation', async () => {
      (apiClient.get as any).mockResolvedValue({
        data: { data: { name: 'missing user_id' } },
      });

      await expect(userApi.getProfile()).rejects.toThrow();
    });

    it('propagates API errors', async () => {
      (apiClient.get as any).mockRejectedValue(new Error('Unauthorized'));

      await expect(userApi.getProfile()).rejects.toThrow('Unauthorized');
    });
  });

  describe('upsertProfile', () => {
    const req = { name: 'Sam', city: 'Oslo', country: 'Norway' };
    const validResponse = {
      message: 'ok',
      user: {
        user_id: 'user-9',
        name: 'Sam',
        city: 'Oslo',
        country: 'Norway',
        additional_data: null,
      },
    };

    it('POSTs /v1/users/profile and returns the upserted user', async () => {
      (apiClient.post as any).mockResolvedValue({
        data: { data: validResponse },
      });

      const result = await userApi.upsertProfile(req);

      expect(apiClient.post).toHaveBeenCalledWith('/v1/users/profile', req);
      expect(result.user_id).toBe('user-9');
      expect(result.name).toBe('Sam');
    });

    it('throws on an invalid request payload (empty name) without calling the API', async () => {
      await expect(
        userApi.upsertProfile({ name: '', city: 'Oslo', country: 'Norway' })
      ).rejects.toThrow();
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('throws when the response fails validation', async () => {
      (apiClient.post as any).mockResolvedValue({
        data: { data: { message: 'ok', user: { name: 'missing user_id' } } },
      });

      await expect(userApi.upsertProfile(req)).rejects.toThrow();
    });
  });

  describe('updatePreferredLocale', () => {
    const validResponse = {
      user: {
        user_id: 'user-9',
        name: 'Sam',
        city: 'Oslo',
        country: 'Norway',
        preferred_locale: 'es',
        additional_data: null,
      },
    };

    it('PATCHes /v1/users/me with only preferred_locale and returns the updated user (different envelope shape than upsertProfile)', async () => {
      (apiClient.patch as any).mockResolvedValue({
        data: { data: validResponse },
      });

      const result = await userApi.updatePreferredLocale({
        preferred_locale: 'es',
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/v1/users/me', {
        preferred_locale: 'es',
      });
      expect(result.preferred_locale).toBe('es');
    });

    it('rejects an empty locale without calling the API', async () => {
      await expect(
        userApi.updatePreferredLocale({ preferred_locale: '' })
      ).rejects.toThrow();
      expect(apiClient.patch).not.toHaveBeenCalled();
    });

    it('throws when the response fails validation', async () => {
      (apiClient.patch as any).mockResolvedValue({
        data: { data: { user: { name: 'missing user_id' } } },
      });

      await expect(
        userApi.updatePreferredLocale({ preferred_locale: 'es' })
      ).rejects.toThrow();
    });
  });

  describe('deleteAccount', () => {
    it('DELETEs /v1/users/me and returns the validated result', async () => {
      (apiClient.delete as any).mockResolvedValue({
        data: { data: { success: true, message: 'deleted' } },
      });

      const result = await userApi.deleteAccount();

      expect(apiClient.delete).toHaveBeenCalledWith('/v1/users/me');
      expect(result.success).toBe(true);
      expect(result.message).toBe('deleted');
    });

    it('throws when the response fails validation', async () => {
      (apiClient.delete as any).mockResolvedValue({
        data: { data: { message: 'missing success flag' } },
      });

      await expect(userApi.deleteAccount()).rejects.toThrow();
    });

    it('propagates API errors', async () => {
      (apiClient.delete as any).mockRejectedValue(new Error('boom'));

      await expect(userApi.deleteAccount()).rejects.toThrow('boom');
    });
  });
});

/**
 * @module api/endpoints/__tests__/household.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for every householdApi method, using the shared
 * `mock.module('@/src/api/client', …)` seam pattern (see user.test.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let householdApi: any;
let apiClient: any;

const now = '2026-01-01T00:00:00.000Z';

const validHousehold = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'The Smiths',
  timezone: 'Europe/London',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'all',
  approval_timeout_minutes: 60,
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_by: '22222222-2222-4222-8222-222222222222',
  created_at: now,
  updated_at: now,
};

const validInvite = {
  id: '33333333-3333-4333-8333-333333333333',
  household_id: validHousehold.id,
  code: 'R4K-92T',
  email: null,
  role: 'nanny',
  invited_by: '22222222-2222-4222-8222-222222222222',
  expires_at: now,
  status: 'pending',
  accepted_by: null,
  accepted_at: null,
  created_at: now,
  updated_at: now,
};

const validMembership = {
  id: '44444444-4444-4444-8444-444444444444',
  household_id: validHousehold.id,
  user_id: '55555555-5555-4555-8555-555555555555',
  role: 'nanny',
  can_edit: true,
  status: 'active',
  display_name_override: null,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
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

  const mod = await import('../household');
  householdApi = mod.householdApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
  apiClient.patch.mockReset?.();
});

describe('householdApi.list', () => {
  it('GETs /v1/households and returns the validated list', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { households: [validHousehold] } },
    });

    const result = await householdApi.list();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/households');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('The Smiths');
  });

  it('throws when the response fails validation', async () => {
    apiClient.get.mockResolvedValue({ data: { data: { households: 'x' } } });
    await expect(householdApi.list()).rejects.toThrow();
  });
});

describe('householdApi.create', () => {
  it('POSTs /v1/households and returns the created household', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { household: validHousehold } },
    });

    const result = await householdApi.create({ name: 'The Smiths' });

    expect(apiClient.post).toHaveBeenCalledWith('/v1/households', {
      name: 'The Smiths',
    });
    expect(result.id).toBe(validHousehold.id);
  });

  it('rejects an empty name without calling the API', async () => {
    await expect(householdApi.create({ name: '' })).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('householdApi.update', () => {
  it('PATCHes /v1/households/:id with only the given diff and returns the updated household', async () => {
    const updated = { ...validHousehold, name: 'The Reyes Household' };
    apiClient.patch.mockResolvedValue({
      data: { data: { household: updated } },
    });

    const result = await householdApi.update(validHousehold.id, {
      name: 'The Reyes Household',
    });

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/v1/households/${validHousehold.id}`,
      { name: 'The Reyes Household' }
    );
    expect(result.name).toBe('The Reyes Household');
  });

  it('sends only the timezone field when that is the only change', async () => {
    apiClient.patch.mockResolvedValue({
      data: {
        data: { household: { ...validHousehold, timezone: 'Asia/Tokyo' } },
      },
    });

    await householdApi.update(validHousehold.id, { timezone: 'Asia/Tokyo' });

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/v1/households/${validHousehold.id}`,
      { timezone: 'Asia/Tokyo' }
    );
  });

  it('rejects an empty diff without calling the API', async () => {
    await expect(householdApi.update(validHousehold.id, {})).rejects.toThrow();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});

describe('householdApi.createInvite', () => {
  it('POSTs to /v1/households/:id/invites and returns the invite', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { invite: validInvite } },
    });

    const result = await householdApi.createInvite(validHousehold.id, {
      role: 'nanny',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${validHousehold.id}/invites`,
      { role: 'nanny' }
    );
    expect(result.code).toBe('R4K-92T');
  });
});

describe('householdApi.previewInvite', () => {
  it('GETs the preview and returns household name + child first names', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          household_name: 'The Smiths',
          children_first_names: ['Ada', 'Ben'],
          role: 'nanny',
        },
      },
    });

    const result = await householdApi.previewInvite('R4K-92T');

    expect(apiClient.get).toHaveBeenCalledWith(
      '/v1/households/invites/R4K-92T/preview'
    );
    expect(result.household_name).toBe('The Smiths');
    expect(result.children_first_names).toEqual(['Ada', 'Ben']);
  });
});

describe('householdApi.redeemInvite', () => {
  it('POSTs the code and returns the resulting membership', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { membership: validMembership } },
    });

    const result = await householdApi.redeemInvite('R4K-92T');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/households/invites/redeem',
      { code: 'R4K-92T' }
    );
    expect(result.status).toBe('active');
  });

  it('rejects an empty code without calling the API', async () => {
    await expect(householdApi.redeemInvite('')).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

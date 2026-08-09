/**
 * @module api/endpoints/__tests__/household.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for every householdApi method, using the shared
 * `mock.module('@/src/api/client', …)` seam pattern (see user.test.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';

let householdApi: any;
let apiClient: any;

const now = '2026-01-01T00:00:00.000Z';

// Typed against the shared wire contract, not left as a bare literal: an
// untyped fixture widens `approval_mode`/`approval_scope` to `string`, which
// then fails to satisfy the schema's enums anywhere the fixture is handed to
// something typed.
const validHousehold: Household = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'The Smiths',
  timezone: 'Europe/London',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'all',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_by: '22222222-2222-4222-8222-222222222222',
  created_at: now,
  updated_at: now,
};

const pastHouseholdId = '99999999-9999-4999-8999-999999999999';

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

  // The active list is what every write path and role check reads. A removed
  // household appearing here would offer a nanny a household she can no
  // longer act in.
  it('never leaks a past household into the active list', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          households: [validHousehold],
          past_households: [{ ...validHousehold, id: pastHouseholdId }],
        },
      },
    });

    const result = await householdApi.list();

    expect(result.map((h: { id: string }) => h.id)).toEqual([
      validHousehold.id,
    ]);
  });
});

describe('householdApi.listPast', () => {
  // A removed nanny's only route back to the hours she worked.
  it('returns the households the caller was removed from', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          households: [validHousehold],
          past_households: [
            { ...validHousehold, id: pastHouseholdId, name: 'The Joneses' },
          ],
        },
      },
    });

    const result = await householdApi.listPast();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/households');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('The Joneses');
  });

  // Forward compatibility: this build talking to a server that predates
  // `past_households` must degrade to "no past households", never throw.
  it('returns [] when the server omits past_households entirely', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { households: [validHousehold] } },
    });

    expect(await householdApi.listPast()).toEqual([]);
  });
});

// Backward compatibility, the other direction: a SHIPPED client parsing the
// pre-change envelope against the new payload. Zod objects are non-strict, so
// the added key is stripped and the old client is untouched — this is why
// extending the envelope cannot break anyone.
describe('past_households is additive-only on the wire', () => {
  it('a client on the pre-change envelope schema still parses the new payload', async () => {
    const { z } = await import('zod');
    const { HouseholdSchema } = await import(
      '@steadily-nanny/shared-types/schemas/household.schema'
    );
    const preChangeSchema = z.object({
      households: z.array(HouseholdSchema),
    });

    const parsed = preChangeSchema.parse({
      households: [validHousehold],
      past_households: [{ ...validHousehold, id: pastHouseholdId }],
    });

    expect(parsed).toEqual({ households: [validHousehold] });
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

describe('householdApi.listMembers', () => {
  it('GETs /v1/households/:id/members and returns validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { household_members: [validMembership] } },
    });

    const result = await householdApi.listMembers(validHousehold.id);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${validHousehold.id}/members`
    );
    expect(result).toHaveLength(1);
    expect(result[0].user_id).toBe(validMembership.user_id);
  });

  it('throws when the response fails validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { household_members: 'x' } },
    });
    await expect(householdApi.listMembers(validHousehold.id)).rejects.toThrow();
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

describe('householdApi.updateMember', () => {
  it('PATCHes /v1/households/:id/members/:memberId and returns the updated member', async () => {
    const removed = { ...validMembership, status: 'removed' };
    apiClient.patch.mockResolvedValue({
      data: { data: { household_member: removed } },
    });

    const result = await householdApi.updateMember(
      validHousehold.id,
      validMembership.id,
      { status: 'removed' }
    );

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/v1/households/${validHousehold.id}/members/${validMembership.id}`,
      { status: 'removed' }
    );
    expect(result.status).toBe('removed');
  });

  it('rejects an empty diff without calling the API', async () => {
    await expect(
      householdApi.updateMember(validHousehold.id, validMembership.id, {})
    ).rejects.toThrow();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});

describe('householdApi.updateInvite', () => {
  it('PATCHes /v1/households/:id/invites/:inviteId and returns the updated invite', async () => {
    const revoked = { ...validInvite, status: 'revoked' };
    apiClient.patch.mockResolvedValue({
      data: { data: { invite: revoked } },
    });

    const result = await householdApi.updateInvite(
      validHousehold.id,
      validInvite.id,
      { status: 'revoked' }
    );

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/v1/households/${validHousehold.id}/invites/${validInvite.id}`,
      { status: 'revoked' }
    );
    expect(result.status).toBe('revoked');
  });

  it('rejects a status other than revoked without calling the API', async () => {
    await expect(
      householdApi.updateInvite(validHousehold.id, validInvite.id, {
        status: 'accepted',
      })
    ).rejects.toThrow();
    expect(apiClient.patch).not.toHaveBeenCalled();
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

describe('householdApi.leave', () => {
  it('POSTs to the members/leave route with no body', async () => {
    apiClient.post.mockResolvedValue({ data: { data: {} } });

    await householdApi.leave(validHousehold.id);

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${validHousehold.id}/members/leave`
    );
  });

  it('propagates the API refusal (owner / clocked in) rather than swallowing it', async () => {
    apiClient.post.mockRejectedValue(
      Object.assign(new Error('refused'), {
        response: {
          status: 403,
          data: { error: { code: 'CANNOT_LEAVE_AS_OWNER' } },
        },
      })
    );

    await expect(householdApi.leave(validHousehold.id)).rejects.toThrow(
      'refused'
    );
  });
});

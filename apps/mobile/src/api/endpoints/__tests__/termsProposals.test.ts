/**
 * @module api/endpoints/__tests__/termsProposals.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for termsProposalApi — including the two refusals that must
 * never reach the wire: a malformed `terms` payload on propose, and an
 * acceptance whose `responsibility_confirmed` is not literally `true`
 * (D-7's liability checkbox, `AcceptTermsProposalRequestSchema`).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let termsProposalApi: any;
let apiClient: any;

const now = '2026-08-10T00:00:00.000Z';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444';
const SUPERSEDED_ID = '55555555-5555-4555-8555-555555555555';

const base = `/v1/households/${HOUSEHOLD_ID}/carers/${CARER_ID}/terms-proposals`;

const validTerms = {
  rate_minor: 2800,
  currency: 'USD',
  overtime_multiplier: 1.5,
  overtime_threshold_minutes: 2400,
  guaranteed_minutes_per_week: 3000,
  valid_from: '2026-08-17',
};

const validProposal = {
  id: PROPOSAL_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  proposed_by: CARER_ID,
  direction: 'carer',
  status: 'proposed',
  terms: validTerms,
  note: 'This is what I usually work.',
  supersedes_id: null,
  from_invite_id: null,
  carer_display_name: 'Marisol Reyes',
  weekly_equivalent_minor: 154000,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
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

  const mod = await import('../termsProposals');
  termsProposalApi = mod.termsProposalApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
});

describe('termsProposalApi.list', () => {
  it('GETs the list route and returns the validated chain', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { terms_proposals: [validProposal] } },
    });

    const result = await termsProposalApi.list(HOUSEHOLD_ID, CARER_ID);

    expect(apiClient.get).toHaveBeenCalledWith(base);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('proposed');
  });

  it('throws on a row with an unknown status rather than returning it', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: { terms_proposals: [{ ...validProposal, status: 'expired' }] },
      },
    });

    await expect(
      termsProposalApi.list(HOUSEHOLD_ID, CARER_ID)
    ).rejects.toThrow();
  });
});

describe('termsProposalApi.getCurrent', () => {
  it('GETs /current and returns the validated proposal', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { terms_proposal: validProposal } },
    });

    const result = await termsProposalApi.getCurrent(HOUSEHOLD_ID, CARER_ID);

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/current`);
    expect(result?.id).toBe(PROPOSAL_ID);
  });

  it('returns null (not undefined, not thrown) when nothing is on the table', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { terms_proposal: null } },
    });

    const result = await termsProposalApi.getCurrent(HOUSEHOLD_ID, CARER_ID);

    expect(result).toBeNull();
  });

  it('throws when the payload fails TermsProposalSchema', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          terms_proposal: { ...validProposal, weekly_equivalent_minor: -1 },
        },
      },
    });

    await expect(
      termsProposalApi.getCurrent(HOUSEHOLD_ID, CARER_ID)
    ).rejects.toThrow();
  });
});

describe('termsProposalApi.propose', () => {
  it('POSTs the validated body and returns the created proposal', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { terms_proposal: validProposal } },
    });

    const result = await termsProposalApi.propose(HOUSEHOLD_ID, CARER_ID, {
      terms: validTerms,
      note: 'This is what I usually work.',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      base,
      expect.objectContaining({
        terms: expect.objectContaining({ rate_minor: 2800 }),
        note: 'This is what I usually work.',
      })
    );
    expect(result.id).toBe(PROPOSAL_ID);
  });

  it('carries supersedes_id through — a counter is the SAME endpoint', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: {
          terms_proposal: { ...validProposal, supersedes_id: SUPERSEDED_ID },
        },
      },
    });

    const result = await termsProposalApi.propose(HOUSEHOLD_ID, CARER_ID, {
      terms: validTerms,
      supersedes_id: SUPERSEDED_ID,
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      base,
      expect.objectContaining({ supersedes_id: SUPERSEDED_ID })
    );
    expect(result.supersedes_id).toBe(SUPERSEDED_ID);
  });

  it('rejects a body whose terms fail CreatePayArrangementRequestSchema', async () => {
    await expect(
      termsProposalApi.propose(HOUSEHOLD_ID, CARER_ID, {
        terms: { ...validTerms, rate_minor: -5 },
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('rejects a note over 280 characters without calling the API', async () => {
    await expect(
      termsProposalApi.propose(HOUSEHOLD_ID, CARER_ID, {
        terms: validTerms,
        note: 'x'.repeat(281),
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('termsProposalApi.accept', () => {
  const acceptedProposal = {
    ...validProposal,
    status: 'accepted',
    responded_at: now,
    accepted_by: '66666666-6666-4666-8666-666666666666',
    accepted_arrangement_id: '77777777-7777-4777-8777-777777777777',
    responsibility_confirmed: true,
  };

  it('POSTs .../accept with the confirmation and returns the accepted proposal', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { terms_proposal: acceptedProposal } },
    });

    const result = await termsProposalApi.accept(PROPOSAL_ID, {
      responsibility_confirmed: true,
    });

    // Keyed by the ROW, not the (household, carer) pair: the review screen is
    // reached by proposal id from a push deep link, and it learns the pair
    // from the row it fetched.
    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/terms-proposals/${PROPOSAL_ID}/accept`,
      { responsibility_confirmed: true }
    );
    expect(result.status).toBe('accepted');
    expect(result.accepted_arrangement_id).toBe(
      '77777777-7777-4777-8777-777777777777'
    );
  });

  it('refuses responsibility_confirmed: false without calling the API', async () => {
    await expect(
      termsProposalApi.accept(PROPOSAL_ID, {
        responsibility_confirmed: false,
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('termsProposalApi.withdraw', () => {
  it('POSTs .../withdraw and returns the withdrawn proposal', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: {
          terms_proposal: {
            ...validProposal,
            status: 'withdrawn',
            responded_at: now,
          },
        },
      },
    });

    const result = await termsProposalApi.withdraw(PROPOSAL_ID);

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/terms-proposals/${PROPOSAL_ID}/withdraw`
    );
    expect(result.status).toBe('withdrawn');
  });
});

describe('termsProposalApi.markViewed', () => {
  it('POSTs .../viewed and returns the proposal carrying viewed_at', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: { terms_proposal: { ...validProposal, viewed_at: now } },
      },
    });

    const result = await termsProposalApi.markViewed(PROPOSAL_ID);

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/terms-proposals/${PROPOSAL_ID}/viewed`
    );
    expect(result.viewed_at).toBe(now);
  });
});

describe('termsProposalApi.getById', () => {
  it('GETs the row-scoped route and returns the validated proposal', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { terms_proposal: validProposal } },
    });

    const result = await termsProposalApi.getById(PROPOSAL_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/terms-proposals/${PROPOSAL_ID}`
    );
    expect(result.id).toBe(PROPOSAL_ID);
  });

  it('throws rather than returning a payload that fails the shared schema', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { terms_proposal: { ...validProposal, status: 'maybe' } } },
    });

    await expect(termsProposalApi.getById(PROPOSAL_ID)).rejects.toThrow();
  });
});

/**
 * @module hooks/queries/__tests__/useInvitePayOffer.test
 *
 * F3(c) — the redeemed invite's `pay_offer`, so `PaySetupScreen` can prefill
 * from it instead of asking the parent to retype terms he already wrote.
 * Covers: disabled with no householdId/carerId, finds the invite matching
 * `accepted_by === carerId` that carries a `pay_offer`, ignores every other
 * invite (no match, no offer, someone else's redemption), and resolves
 * `null` — never an error — when nothing matches.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CARER_ID = '55555555-5555-4555-8555-555555555555';

const OFFER = {
  rate_minor: 2200,
  currency: 'USD',
  overtime_multiplier: 1.5,
  valid_from: '2026-08-01',
};

const invite = (overrides: Record<string, unknown> = {}) => ({
  id: '44444444-4444-4444-8444-444444444444',
  household_id: HOUSEHOLD_ID,
  code: 'ABC-123',
  email: null,
  role: 'nanny',
  invited_by: 'parent-1',
  expires_at: '2026-09-01T00:00:00.000Z',
  status: 'accepted',
  accepted_by: CARER_ID,
  accepted_at: '2026-08-01T00:00:00.000Z',
  link_expires_at: null,
  opened_at: null,
  label: null,
  pay_offer: OFFER,
  pay_offer_promotion: 'promoted',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const listInvitesMock = mock(() => Promise.resolve([invite()]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { listInvites: listInvitesMock },
}));

let useInvitePayOffer: typeof import('../useInvitePayOffer').useInvitePayOffer;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  useInvitePayOffer = (await import('../useInvitePayOffer')).useInvitePayOffer;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  listInvitesMock.mockReset();
  listInvitesMock.mockImplementation(() => Promise.resolve([invite()]));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useInvitePayOffer', () => {
  it('does not fetch when householdId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useInvitePayOffer(undefined, CARER_ID)
    );

    expect(result.current.isPending).toBe(true);
    expect(listInvitesMock).not.toHaveBeenCalled();
  });

  it('does not fetch when carerId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useInvitePayOffer(HOUSEHOLD_ID, undefined)
    );

    expect(result.current.isPending).toBe(true);
    expect(listInvitesMock).not.toHaveBeenCalled();
  });

  it('finds the offer on the invite this carer redeemed', async () => {
    const { result } = renderHookWithProviders(() =>
      useInvitePayOffer(HOUSEHOLD_ID, CARER_ID)
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listInvitesMock).toHaveBeenCalledWith(HOUSEHOLD_ID);
    expect(result.current.data).toEqual(OFFER);
  });

  it('resolves null, not an error, when no invite carries a pay_offer', async () => {
    listInvitesMock.mockImplementation(() =>
      Promise.resolve([invite({ pay_offer: null })])
    );

    const { result } = renderHookWithProviders(() =>
      useInvitePayOffer(HOUSEHOLD_ID, CARER_ID)
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('ignores an offer on an invite redeemed by a DIFFERENT carer', async () => {
    listInvitesMock.mockImplementation(() =>
      Promise.resolve([invite({ accepted_by: OTHER_CARER_ID })])
    );

    const { result } = renderHookWithProviders(() =>
      useInvitePayOffer(HOUSEHOLD_ID, CARER_ID)
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('ignores an invite this carer has not yet redeemed (no accepted_by match)', async () => {
    listInvitesMock.mockImplementation(() =>
      Promise.resolve([invite({ accepted_by: null, status: 'pending' })])
    );

    const { result } = renderHookWithProviders(() =>
      useInvitePayOffer(HOUSEHOLD_ID, CARER_ID)
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

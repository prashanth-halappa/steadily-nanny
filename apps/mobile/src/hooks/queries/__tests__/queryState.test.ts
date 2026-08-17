/**
 * @module hooks/queries/__tests__/queryState.test
 *
 * Pins the two rules `docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §B/§C exist to
 * enforce: an errored query outranks a pending one (C6's unreachable-retry
 * bug is exactly the reverse order), and `retry` only ever refetches the
 * queries that actually failed.
 */
import { describe, expect, it, mock } from 'bun:test';
import { onboardingAsQuery, queryState } from '../queryState';
import type { OnboardingState } from '../useIsOnboarded';

function query(overrides: Partial<{ isPending: boolean; isError: boolean }>) {
  return {
    isPending: false,
    isError: false,
    refetch: mock(() => undefined),
    ...overrides,
  };
}

describe('queryState', () => {
  it('is ready with zero queries', () => {
    expect(queryState().status).toBe('ready');
  });

  it('is ready once every query has settled successfully', () => {
    const a = query({});
    const b = query({});
    expect(queryState(a, b).status).toBe('ready');
  });

  it('is loading while any query is pending and none has errored', () => {
    const a = query({ isPending: true });
    const b = query({});
    expect(queryState(a, b).status).toBe('loading');
  });

  it('errored wins over pending — the reverse order is C6s bug', () => {
    const pending = query({ isPending: true });
    const errored = query({ isError: true });
    expect(queryState(pending, errored).status).toBe('error');
  });

  it('retry refetches ONLY the errored queries, never the whole set', () => {
    const ok = query({});
    const errored1 = query({ isError: true });
    const errored2 = query({ isError: true });

    const state = queryState(ok, errored1, errored2);
    state.retry();

    expect(ok.refetch).not.toHaveBeenCalled();
    expect(errored1.refetch).toHaveBeenCalledTimes(1);
    expect(errored2.refetch).toHaveBeenCalledTimes(1);
  });

  it('retry on a ready state calls no refetch at all', () => {
    const a = query({});
    const state = queryState(a);
    state.retry();
    expect(a.refetch).not.toHaveBeenCalled();
  });
});

function onboardingState(
  overrides: Partial<Pick<OnboardingState, 'status' | 'membershipsError'>>
): { state: OnboardingState; retryMemberships: ReturnType<typeof mock> } {
  const retryMemberships = mock(() => undefined);
  return {
    state: {
      status: 'loading',
      role: null,
      membershipRole: null,
      householdId: null,
      householdState: null,
      isPastMember: false,
      membershipsError: false,
      retryMemberships,
      ...overrides,
    },
    retryMemberships,
  };
}

describe('onboardingAsQuery', () => {
  it('maps a failed memberships read to isError, not isPending', () => {
    const { state } = onboardingState({
      status: 'loading',
      membershipsError: true,
    });
    expect(onboardingAsQuery(state).isError).toBe(true);
  });

  it('composes with queryState so a failed onboarding read reports error', () => {
    const { state, retryMemberships } = onboardingState({
      status: 'loading',
      membershipsError: true,
    });
    const result = queryState(onboardingAsQuery(state));

    expect(result.status).toBe('error');
    result.retry();
    expect(retryMemberships).toHaveBeenCalledTimes(1);
  });

  it('maps a genuinely loading onboarding read to isPending, not isError', () => {
    const { state } = onboardingState({
      status: 'loading',
      membershipsError: false,
    });
    const asQuery = onboardingAsQuery(state);
    expect(asQuery.isPending).toBe(true);
    expect(asQuery.isError).toBe(false);
  });

  it('maps a settled onboarding read to neither pending nor error', () => {
    const { state } = onboardingState({
      status: 'onboarded',
      membershipsError: false,
    });
    const asQuery = onboardingAsQuery(state);
    expect(asQuery.isPending).toBe(false);
    expect(asQuery.isError).toBe(false);
  });
});

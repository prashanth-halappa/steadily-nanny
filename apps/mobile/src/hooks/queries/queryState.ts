/**
 * @module hooks/queries/queryState
 *
 * The three-state shape `docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §B/§C found
 * independently reinvented three times (`useUncoveredToday`, `useTermsGate`,
 * `ShiftDetailScreen`) with no shared helper — this is that helper.
 *
 * RULES:
 *  - ERROR WINS OVER LOADING. A query that is both `isPending` (still
 *    resolving after a refetch) and `isError` (its LAST settled attempt
 *    failed) must report `'error'`, never `'loading'` — C6's bug was
 *    exactly this check in the wrong order, and it makes the retry button
 *    unreachable forever.
 *  - `retry()` refetches ONLY the queries that are actually `isError` —
 *    never the whole set, which would re-fire requests that already
 *    succeeded.
 *  - Zero queries is `'ready'`. A screen with nothing left to wait on has
 *    nothing to be wrong about either.
 *
 * PITFALL: a query with `enabled: false` is `isPending` forever (TanStack
 * Query v5 never marks a disabled query as settled) — passing one straight
 * through would pin every caller's status at `'loading'` for good. Gate it
 * at the call site instead: `queryState(...(enabled ? [q] : []))`.
 */
export interface QueryLike {
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

export type QueryStatus = 'loading' | 'error' | 'ready';

export interface QueryState {
  status: QueryStatus;
  retry: () => void;
}

export function queryState(...queries: QueryLike[]): QueryState {
  const errored = queries.filter(q => q.isError);
  const retry = () => {
    for (const q of errored) void q.refetch();
  };

  if (errored.length > 0) return { status: 'error', retry };
  if (queries.some(q => q.isPending)) return { status: 'loading', retry };
  return { status: 'ready', retry };
}

/**
 * Adapts `useIsOnboarded`'s result into a `QueryLike` so a screen's
 * membership read composes with its other queries through the same
 * `queryState(...)` call instead of a hand-rolled `onboarding.status ===
 * 'loading'` check that (per C6) forgets to branch on `membershipsError`.
 */
export function onboardingAsQuery(onboarding: {
  status: string;
  membershipsError: boolean;
  retryMemberships: () => void;
}): QueryLike {
  return {
    isPending: onboarding.status === 'loading',
    isError: onboarding.membershipsError,
    refetch: onboarding.retryMemberships,
  };
}

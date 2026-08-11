/**
 * Shared stubs for the termsProposal service tests. Plain constructor DI —
 * this domain injects every collaborator, so no `mock.module()` is needed
 * here (see `payArrangementAckService.test.ts`, the same shape).
 *
 * @module tests/unit/domains/termsProposal/services/fixtures
 */
import { mock } from 'bun:test';

export const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CARER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const PARENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const HELPER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const PRIOR_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** A well-formed `CreatePayArrangementRequest` — the spec's worked example. */
export function terms(overrides: Record<string, unknown> = {}) {
  return {
    rate_minor: 2800,
    currency: 'USD',
    overtime_threshold_minutes: 2400,
    overtime_multiplier: 1.5,
    guaranteed_minutes_per_week: 3000,
    valid_from: '2026-08-17',
    ...overrides,
  };
}

export function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    proposed_by: CARER_ID,
    direction: 'carer',
    status: 'proposed',
    terms: terms(),
    note: null,
    supersedes_id: null,
    from_invite_id: null,
    carer_display_name: 'Marisol',
    viewed_at: null,
    responded_at: null,
    accepted_by: null,
    accepted_arrangement_id: null,
    responsibility_confirmed: false,
    created_at: '2026-08-10T09:00:00.000Z',
    updated_at: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}

export function member(
  role: string,
  status = 'active',
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `member-${role}-${status}`,
    role,
    status,
    display_name_override: null,
    ...overrides,
  };
}

export function makeProposalRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async (id: string) =>
      id === PROPOSAL_ID ? proposal() : null
    ),
    findOpenForCarer: mock(async () => null),
    listChain: mock(async () => [proposal()]),
    create: mock(async (row: Record<string, unknown>) =>
      proposal({ id: 'new-proposal', ...row })
    ),
    resolve: mock(async (id: string, patch: Record<string, unknown>) =>
      proposal({ id, ...patch })
    ),
    stampViewed: mock(async (id: string, at: string) =>
      proposal({ id, viewed_at: at })
    ),
    ...overrides,
  };
}

/**
 * A membership fake that implements the REAL methods' status semantics, keyed
 * by user id.
 *
 * This honesty is the whole point. A stub that returned the same row from
 * every lookup made the three methods indistinguishable, so the suite could
 * only prove a gate CALLED something — not that it called the right thing. A
 * fake more permissive than the thing it stands for does not test a gate.
 * That is exactly how the candidate carve-out broke silently when
 * `findMembershipAnyStatus` narrowed to `{active, removed}`.
 */
export function makeMemberRepo(
  byUserId: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): any {
  const rowFor = (userId: string) =>
    byUserId[userId] as { status?: string } | undefined;
  return {
    // `{active, removed}` — the money-read lookup. A CANDIDATE IS NULL HERE.
    findMembershipAnyStatus: mock(async (_h: string, userId: string) => {
      const row = rowFor(userId);
      return row?.status === 'active' || row?.status === 'removed' ? row : null;
    }),
    // Any status at all — the only lookup that can see a candidate.
    findMembershipIncludingCandidate: mock(
      async (_h: string, userId: string) => rowFor(userId) ?? null
    ),
    findActiveMembership: mock(async (_h: string, userId: string) =>
      rowFor(userId)?.status === 'active' ? rowFor(userId) : null
    ),
    ...overrides,
  };
}

export function makeHouseholdRepo(timezone = 'America/Chicago'): any {
  return {
    findById: mock(async () => ({
      id: HOUSEHOLD_ID,
      timezone,
      currency: 'USD',
    })),
  };
}

export function makePush(): any {
  return {
    notifyUser: mock(() => {}),
    notifyHouseholdParents: mock(() => {}),
  };
}

export function makeUserService(name: string | null = 'Marisol'): any {
  return { getProfileById: mock(async () => ({ name })) };
}

export function makeArrangements(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async () => ({ id: 'arrangement-1' })),
    ...overrides,
  };
}

export function makeCandidates(): any {
  return { activateCandidate: mock(async () => ({ status: 'active' })) };
}

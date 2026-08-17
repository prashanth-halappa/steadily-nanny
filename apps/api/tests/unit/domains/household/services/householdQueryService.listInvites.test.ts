/**
 * `listInvites` — the parent's record of every code she has minted.
 *
 * Two things are load-bearing here and neither is obvious from the signature:
 * the gate is PARENTS-ONLY because each row carries a live bearer token for
 * joining the family, and `pending` is repaired to `expired` on read because
 * nothing flips that column on a schedule.
 */
import { describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';
import { HouseholdQueryService } from '../../../../../src/domains/household/services/householdQueryService';
import type {
  Household,
  HouseholdInvite,
  HouseholdMember,
} from '../../../../../src/domains/household/types';

const NOW = new Date('2026-08-16T09:00:00.000Z');
const now = () => NOW;

const household = {
  id: 'h1',
  name: 'The Smiths',
  state: 'live',
  created_by: 'u1',
} as unknown as Household;

const owner = {
  id: 'm1',
  household_id: 'h1',
  user_id: 'u1',
  role: 'owner',
  status: 'active',
} as unknown as HouseholdMember;

const nanny = {
  ...owner,
  id: 'm2',
  user_id: 'u2',
  role: 'nanny',
} as unknown as HouseholdMember;

function makeInvite(over: Partial<HouseholdInvite> = {}): HouseholdInvite {
  return {
    id: 'i1',
    household_id: 'h1',
    code: 'ABC-234',
    role: 'nanny',
    status: 'pending',
    // Wire form: PostgREST returns `+00:00`, not `.000Z` (GOLDEN-FIXES #25).
    expires_at: '2026-09-15T09:00:00+00:00',
    ...over,
  } as HouseholdInvite;
}

function build(
  membership: HouseholdMember,
  invites: HouseholdInvite[]
): HouseholdQueryService {
  return new HouseholdQueryService(
    { findById: mock(async () => household) } as never,
    { findActiveMembership: mock(async () => membership) } as never,
    { listByHousehold: mock(async () => invites) } as never
  );
}

describe('HouseholdQueryService.listInvites', () => {
  it('returns the household’s invites for a parent', async () => {
    const svc = build(owner, [makeInvite()]);
    const result = await svc.listInvites('u1', 'h1', now);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('pending');
  });

  it('refuses a nanny — every row carries a live join code', async () => {
    const svc = build(nanny, [makeInvite()]);
    await expect(svc.listInvites('u2', 'h1', now)).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
  });

  it('reports a lapsed pending code as expired without writing it back', async () => {
    const listByHousehold = mock(async () => [
      makeInvite({ expires_at: '2026-08-15T09:00:00+00:00' }),
    ]);
    const svc = new HouseholdQueryService(
      { findById: mock(async () => household) } as never,
      { findActiveMembership: mock(async () => owner) } as never,
      { listByHousehold } as never
    );

    const result = await svc.listInvites('u1', 'h1', now);
    expect(result[0]?.status).toBe('expired');
    // The column is the audit of what somebody decided; expiry is not a
    // decision anybody made, so nothing is written back.
    expect(listByHousehold).toHaveBeenCalledTimes(1);
  });

  it('leaves a code that expires later alone', async () => {
    const svc = build(owner, [
      makeInvite({ expires_at: '2026-08-16T09:00:01+00:00' }),
    ]);
    expect((await svc.listInvites('u1', 'h1', now))[0]?.status).toBe('pending');
  });

  it('never re-opens a terminal status', async () => {
    const svc = build(owner, [
      makeInvite({
        status: 'accepted',
        expires_at: '2020-01-01T00:00:00+00:00',
      }),
      makeInvite({ id: 'i2', status: 'revoked' }),
    ]);
    const result = await svc.listInvites('u1', 'h1', now);
    expect(result.map(i => i.status)).toEqual(['accepted', 'revoked']);
  });
});

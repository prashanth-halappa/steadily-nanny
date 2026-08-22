/**
 * `listDepartedMembers` — who recently left this family.
 *
 * Two things are load-bearing and neither shows in the signature.
 *
 * THE GATE IS PARENTS-ONLY, and not for symmetry with the writes. It is the
 * server half of `ThisFamilyScreen`'s privacy rule
 * (apps/mobile/src/domains/household/components/ThisFamilyScreen.tsx:13-17):
 * one carer is never told who else works for the family, past or present. A
 * list of departures is exactly that fact, so a carer must not be able to
 * enumerate it — and the client filtering it out is not a gate, because the
 * payload would already have crossed the wire.
 *
 * THE ACTOR IS EXCLUDED. 112's `ended_by` comment says the column exists so a
 * read can leave out the person who acted; telling a parent that they removed
 * someone is noise, and it is the co-parent — the one who did not act — the
 * card is for.
 */
import { describe, expect, it, mock } from 'bun:test';
import {
  HouseholdNotFoundError,
  NotAHouseholdParentError,
} from '../../../../../src/domains/household/errors/householdErrors';
import { HouseholdQueryService } from '../../../../../src/domains/household/services/householdQueryService';
import type { HouseholdMember } from '../../../../../src/domains/household/types';

const NOW = new Date('2026-08-21T09:00:00.000Z');
const now = () => NOW;
/** 7 days back from NOW, to the millisecond. */
const WINDOW_START = '2026-08-14T09:00:00.000Z';

function member(over: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    id: 'm1',
    household_id: 'h1',
    user_id: 'u1',
    role: 'owner',
    can_edit: true,
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: 't',
    created_at: 't',
    updated_at: 't',
    ...over,
  } as HouseholdMember;
}

const owner = member();
const coParent = member({ id: 'm2', user_id: 'u2', role: 'parent' });
const nanny = member({ id: 'm3', user_id: 'u3', role: 'nanny' });

function departed(over: Partial<HouseholdMember> = {}): HouseholdMember {
  return member({
    id: 'm9',
    user_id: 'u9',
    role: 'nanny',
    status: 'removed',
    ended_reason: 'left',
    ended_at: '2026-08-20T09:00:00+00:00',
    ended_by: 'u9',
    profile_name: 'Priya',
    ...over,
  });
}

function build(
  membership: HouseholdMember | null,
  rows: HouseholdMember[]
): {
  svc: HouseholdQueryService;
  listDepartedSince: ReturnType<typeof mock>;
} {
  const listDepartedSince = mock(async (..._args: unknown[]) => rows);
  const svc = new HouseholdQueryService(
    { findById: mock(async () => null) } as never,
    {
      findActiveMembership: mock(async () => membership),
      listDepartedSince,
    } as never
  );
  return { svc, listDepartedSince };
}

describe('HouseholdQueryService.listDepartedMembers', () => {
  it('returns the departures for a parent, windowed 7 days back by default', async () => {
    const { svc, listDepartedSince } = build(owner, [departed()]);

    const result = await svc.listDepartedMembers('u1', 'h1', undefined, now);

    expect(listDepartedSince).toHaveBeenCalledWith('h1', WINDOW_START);
    expect(result).toHaveLength(1);
    expect(result[0]?.profile_name).toBe('Priya');
    expect(result[0]?.ended_reason).toBe('left');
  });

  it('honours an explicit window', async () => {
    const { svc, listDepartedSince } = build(owner, []);

    await svc.listDepartedMembers('u1', 'h1', 1, now);

    expect(listDepartedSince).toHaveBeenCalledWith(
      'h1',
      '2026-08-20T09:00:00.000Z'
    );
  });

  // The whole reason the gate is here and not on the client.
  it('refuses a nanny — one carer is never told who else left', async () => {
    const { svc, listDepartedSince } = build(nanny, [departed()]);

    await expect(
      svc.listDepartedMembers('u3', 'h1', undefined, now)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(listDepartedSince).not.toHaveBeenCalled();
  });

  // "Missing" and "not yours" are the same answer everywhere in this domain.
  it('404s a non-member with the opaque household error', async () => {
    const { svc, listDepartedSince } = build(null, [departed()]);

    await expect(
      svc.listDepartedMembers('stranger', 'h1', undefined, now)
    ).rejects.toBeInstanceOf(HouseholdNotFoundError);
    expect(listDepartedSince).not.toHaveBeenCalled();
  });

  it('leaves out the departure the caller caused', async () => {
    // The parent who removed her does not need telling; the co-parent does.
    const removedByCaller = departed({
      ended_reason: 'removed_by_parent',
      ended_by: 'u1',
    });
    const { svc } = build(owner, [removedByCaller, departed({ id: 'm10' })]);

    const result = await svc.listDepartedMembers('u1', 'h1', undefined, now);

    expect(result.map(row => row.id)).toEqual(['m10']);
  });

  it('still shows the co-parent a removal they did not make', async () => {
    const { svc } = build(coParent, [
      departed({ ended_reason: 'removed_by_parent', ended_by: 'u1' }),
    ]);

    const result = await svc.listDepartedMembers('u2', 'h1', undefined, now);

    expect(result).toHaveLength(1);
  });

  // A row that predates 112 has `ended_by = null`, which is nobody — it must
  // not be read as "the caller", which `null === undefined`-style laxness
  // would do the moment a caller id went missing.
  it('keeps a departure with no recorded actor', async () => {
    const { svc } = build(owner, [departed({ ended_by: null })]);

    expect(
      await svc.listDepartedMembers('u1', 'h1', undefined, now)
    ).toHaveLength(1);
  });
});

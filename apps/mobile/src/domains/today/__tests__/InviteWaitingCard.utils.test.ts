import { describe, expect, it } from 'bun:test';
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';
import { resolveInviteWaiting } from '../components/InviteWaitingCard.utils';

const NOW = new Date('2026-08-16T09:00:00.000Z');
const never = () => false;

function invite(over: Partial<HouseholdInvite> = {}): HouseholdInvite {
  return {
    id: 'inv-1',
    household_id: 'hh-1',
    code: 'R4K-92T',
    email: null,
    role: 'nanny',
    invited_by: null,
    // PostgREST serialises with `+00:00` where JS writes `.000Z` — use the
    // wire form here on purpose (GOLDEN-FIXES #25).
    expires_at: '2026-09-15T09:00:00+00:00',
    status: 'pending',
    accepted_by: null,
    accepted_at: null,
    created_at: '2026-08-16T08:00:00+00:00',
    updated_at: '2026-08-16T08:00:00+00:00',
    ...over,
  } as HouseholdInvite;
}

const base = {
  householdId: 'hh-1',
  hasActiveNanny: false,
  isDismissed: never,
  now: NOW,
};

describe('resolveInviteWaiting', () => {
  it('shows the full card on the day the code was made', () => {
    const state = resolveInviteWaiting({ ...base, invites: [invite()] });
    expect(state.kind).toBe('card');
  });

  it('collapses to one line once the code has waited three days', () => {
    const state = resolveInviteWaiting({
      ...base,
      invites: [invite({ created_at: '2026-08-13T08:00:00+00:00' })],
    });
    expect(state.kind).toBe('quiet');
  });

  it('is still a card on day two', () => {
    const state = resolveInviteWaiting({
      ...base,
      invites: [invite({ created_at: '2026-08-14T08:00:00+00:00' })],
    });
    expect(state.kind).toBe('card');
  });

  it('hides once a nanny has actually joined', () => {
    const state = resolveInviteWaiting({
      ...base,
      hasActiveNanny: true,
      invites: [invite()],
    });
    expect(state.kind).toBe('hidden');
  });

  it('ignores codes that are no longer waiting', () => {
    for (const status of ['accepted', 'revoked', 'expired'] as const) {
      const state = resolveInviteWaiting({
        ...base,
        invites: [invite({ status })],
      });
      expect(state.kind).toBe('hidden');
    }
  });

  it('ignores a co-parent code — it says nothing about childcare starting', () => {
    const state = resolveInviteWaiting({
      ...base,
      invites: [invite({ role: 'parent' })],
    });
    expect(state.kind).toBe('hidden');
  });

  it('keys the dismissal on the invite, so a new code re-arms the card', () => {
    const first = resolveInviteWaiting({ ...base, invites: [invite()] });
    expect(first.kind).not.toBe('hidden');
    if (first.kind === 'hidden') return;

    const dismissedFirst = (key: string) => key === first.dismissKey;
    expect(
      resolveInviteWaiting({
        ...base,
        invites: [invite()],
        isDismissed: dismissedFirst,
      }).kind
    ).toBe('hidden');

    // Same household, new code — she has acted again, so she gets told again.
    expect(
      resolveInviteWaiting({
        ...base,
        invites: [invite({ id: 'inv-2' })],
        isDismissed: dismissedFirst,
      }).kind
    ).toBe('card');
  });

  it('hides when there is no household or no invite', () => {
    expect(
      resolveInviteWaiting({ ...base, householdId: undefined, invites: [] })
        .kind
    ).toBe('hidden');
    expect(resolveInviteWaiting({ ...base, invites: undefined }).kind).toBe(
      'hidden'
    );
  });
});

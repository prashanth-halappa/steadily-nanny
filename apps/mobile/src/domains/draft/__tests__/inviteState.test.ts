/**
 * @module domains/draft/__tests__/inviteState
 *
 * §5.3's state words and the two-date sub-line. The rule under test is that
 * each state REPLACES the previous one while the timeline KEEPS both dates —
 * a row that erased its own history would answer "what is it now" and lose
 * "did this reach them", which is the only question she has.
 */
import { describe, expect, it } from 'bun:test';
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';
import { buildInviteTimeline, resolveInviteState } from '../utils/inviteState';

const NOW = new Date('2026-08-11T12:00:00.000Z');

function invite(overrides: Partial<HouseholdInvite> = {}): HouseholdInvite {
  return {
    id: 'invite-1',
    household_id: 'household-1',
    code: 'R4K-92T',
    email: null,
    role: 'nanny',
    invited_by: 'nanny-1',
    expires_at: '2026-09-09T00:00:00.000Z',
    status: 'pending',
    accepted_by: null,
    accepted_at: null,
    link_expires_at: '2026-08-17T00:00:00.000Z',
    opened_at: null,
    label: 'The Bakers',
    pay_offer: null,
    created_at: '2026-08-10T09:00:00.000Z',
    updated_at: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}

describe('resolveInviteState', () => {
  it('a freshly minted code reads pending "Sent"', () => {
    expect(resolveInviteState(invite(), { viewedAt: null, now: NOW })).toEqual({
      variant: 'pending',
      word: 'sent',
    });
  });

  it('opened_at replaces "Sent" with pending "Opened"', () => {
    expect(
      resolveInviteState(invite({ opened_at: '2026-08-11T08:00:00.000Z' }), {
        viewedAt: null,
        now: NOW,
      })
    ).toEqual({ variant: 'pending', word: 'opened' });
  });

  it('the proposal being viewed in the app outranks the web page being opened', () => {
    expect(
      resolveInviteState(invite({ opened_at: '2026-08-11T08:00:00.000Z' }), {
        viewedAt: '2026-08-11T09:00:00.000Z',
        now: NOW,
      })
    ).toEqual({ variant: 'pending', word: 'viewed' });
  });

  it('an accepted invite reads confirmed "Joined"', () => {
    expect(
      resolveInviteState(
        invite({ status: 'accepted', accepted_at: '2026-08-12T10:00:00.000Z' }),
        { viewedAt: '2026-08-11T09:00:00.000Z', now: NOW }
      )
    ).toEqual({ variant: 'confirmed', word: 'joined' });
  });

  it('a revoked invite reads cancelled "Revoked" even if it was opened first', () => {
    expect(
      resolveInviteState(
        invite({ status: 'revoked', opened_at: '2026-08-11T08:00:00.000Z' }),
        { viewedAt: null, now: NOW }
      )
    ).toEqual({ variant: 'cancelled', word: 'revoked' });
  });

  it('a pending invite past its link expiry reads cancelled "Expired"', () => {
    expect(
      resolveInviteState(invite(), {
        viewedAt: null,
        now: new Date('2026-08-18T00:00:00.000Z'),
      })
    ).toEqual({ variant: 'cancelled', word: 'expired' });
  });

  it("falls back to the code's own expiry when no link window was stored", () => {
    expect(
      resolveInviteState(invite({ link_expires_at: null }), {
        viewedAt: null,
        now: new Date('2026-08-18T00:00:00.000Z'),
      })
    ).toEqual({ variant: 'pending', word: 'sent' });

    expect(
      resolveInviteState(invite({ link_expires_at: null }), {
        viewedAt: null,
        now: new Date('2026-09-10T00:00:00.000Z'),
      })
    ).toEqual({ variant: 'cancelled', word: 'expired' });
  });

  it('an invite that was joined never expires out of "Joined"', () => {
    expect(
      resolveInviteState(
        invite({ status: 'accepted', accepted_at: '2026-08-12T10:00:00.000Z' }),
        { viewedAt: null, now: new Date('2027-01-01T00:00:00.000Z') }
      )
    ).toEqual({ variant: 'confirmed', word: 'joined' });
  });
});

describe('buildInviteTimeline', () => {
  it('keeps every date the row has earned, oldest first', () => {
    expect(
      buildInviteTimeline(
        invite({
          opened_at: '2026-08-11T08:00:00.000Z',
          status: 'accepted',
          accepted_at: '2026-08-12T10:00:00.000Z',
        }),
        { viewedAt: '2026-08-11T09:00:00.000Z' }
      )
    ).toEqual([
      { key: 'sent', date: '2026-08-10T09:00:00.000Z' },
      { key: 'opened', date: '2026-08-11T08:00:00.000Z' },
      { key: 'viewed', date: '2026-08-11T09:00:00.000Z' },
      { key: 'joined', date: '2026-08-12T10:00:00.000Z' },
    ]);
  });

  it('a brand-new invite has one entry, not an empty line', () => {
    expect(buildInviteTimeline(invite(), { viewedAt: null })).toEqual([
      { key: 'sent', date: '2026-08-10T09:00:00.000Z' },
    ]);
  });

  it('records nothing about how many times or from where', () => {
    const timeline = buildInviteTimeline(
      invite({ opened_at: '2026-08-11T08:00:00.000Z' }),
      { viewedAt: null }
    );
    // Deliberately NOT a surveillance log (§5.3): one entry per fact, and the
    // only facts are "did this reach them" milestones.
    expect(timeline).toHaveLength(2);
    expect(Object.keys(timeline[0] ?? {})).toEqual(['key', 'date']);
  });
});

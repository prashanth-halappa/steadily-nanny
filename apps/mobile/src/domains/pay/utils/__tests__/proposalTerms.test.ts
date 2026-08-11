/**
 * @module domains/pay/utils/__tests__/proposalTerms
 *
 * The three pure pieces 3-O's screens rest on: a proposal read as the terms
 * document (`arrangementFromProposal`), the append-only chain behind "How we
 * got here" (`buildProposalChain`), and §10's state words.
 *
 * The weekly figure is deliberately NOT computed here — `arrangementFromProposal`
 * carries the SERVER's `weekly_equivalent_minor` through untouched, and the
 * test below pins that: a client-side `rate × hours` prints $1,400.00 where
 * payroll prints $1,540.00 (§17, D23).
 */
import { describe, expect, it } from 'bun:test';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import {
  arrangementFromProposal,
  buildProposalChain,
  proposalHistoryLabel,
  proposalStateWord,
} from '../proposalTerms';

function fakeT(key: string, params?: Record<string, unknown>): string {
  const templates: Record<string, string> = {
    'proposal.state.proposed': `Proposed ${params?.date}`,
    'proposal.state.countered': `Countered ${params?.date}`,
    'proposal.state.agreedWith': `Agreed with ${params?.name} on ${params?.date}`,
    'proposal.state.withdrawn': `Withdrawn ${params?.date}`,
    'proposal.state.proposedBy': `Proposed by ${params?.name} · ${params?.date}`,
    'proposal.state.counteredBy': `Countered by ${params?.name} · ${params?.date}`,
  };
  return templates[key] ?? key;
}

const baseProposal: TermsProposal = {
  id: 'prop-1',
  household_id: 'hh-1',
  carer_id: 'carer-1',
  proposed_by: 'carer-1',
  direction: 'carer',
  status: 'proposed',
  terms: {
    rate_minor: 2800,
    currency: 'USD',
    overtime_threshold_minutes: 2400,
    overtime_multiplier: 1.5,
    overtime_daily_threshold_minutes: 480,
    doubletime_daily_threshold_minutes: null,
    doubletime_multiplier: null,
    seventh_day_multiplier: null,
    seventh_day_doubletime_after_minutes: null,
    worked_holiday_multiplier: 1.5,
    pay_frequency: 'weekly',
    pay_day_of_week: 5,
    pay_day_of_month: null,
    guaranteed_minutes_per_week: 3000,
    pto_entitlement_minutes_per_year: 4800,
    mileage_rate_per_mile_minor: null,
    cancellation_paid_within_hours: 24,
    valid_from: '2026-08-17',
    terms: { notice_period_days: 28 },
  },
  note: 'Happy to talk it through.',
  supersedes_id: null,
  from_invite_id: 'inv-1',
  carer_display_name: 'Marisol',
  weekly_equivalent_minor: 154000,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: '2026-08-10T15:00:00.000Z',
  updated_at: '2026-08-10T15:00:00.000Z',
};

describe('arrangementFromProposal', () => {
  it('reads a proposal as the terms document — every priced column carried through', () => {
    const arrangement = arrangementFromProposal(baseProposal);
    expect(arrangement.rate_minor).toBe(2800);
    expect(arrangement.currency).toBe('USD');
    expect(arrangement.overtime_threshold_minutes).toBe(2400);
    expect(arrangement.overtime_daily_threshold_minutes).toBe(480);
    expect(arrangement.guaranteed_minutes_per_week).toBe(3000);
    expect(arrangement.pto_entitlement_minutes_per_year).toBe(4800);
    expect(arrangement.worked_holiday_multiplier).toBe(1.5);
    expect(arrangement.pay_frequency).toBe('weekly');
    expect(arrangement.cancellation_paid_within_hours).toBe(24);
    expect(arrangement.valid_from).toBe('2026-08-17');
    expect(arrangement.terms).toEqual({ notice_period_days: 28 });
    expect(arrangement.carer_display_name).toBe('Marisol');
  });

  it('carries the SERVER weekly equivalent, never a client rate × hours', () => {
    // 50 guaranteed hours at $28.00 with overtime after 40h is $1,540.00.
    // A naive multiply prints $1,400.00 — the exact figure §17 forbids.
    expect(arrangementFromProposal(baseProposal).weekly_equivalent_minor).toBe(
      154000
    );
    expect(
      arrangementFromProposal({
        ...baseProposal,
        weekly_equivalent_minor: null,
      }).weekly_equivalent_minor
    ).toBeNull();
  });

  it('omitted optional terms read as null, never as a fabricated default', () => {
    const bare = arrangementFromProposal({
      ...baseProposal,
      terms: {
        rate_minor: 2000,
        valid_from: '2026-09-01',
        overtime_multiplier: 1.5,
      },
    });
    expect(bare.overtime_threshold_minutes).toBeNull();
    expect(bare.guaranteed_minutes_per_week).toBeNull();
    expect(bare.worked_holiday_multiplier).toBeNull();
    expect(bare.cancellation_paid_within_hours).toBeNull();
    expect(bare.mileage_rate_per_mile_minor).toBeNull();
  });
});

describe('buildProposalChain', () => {
  const round1: TermsProposal = {
    ...baseProposal,
    id: 'prop-1',
    status: 'countered',
    responded_at: '2026-08-11T09:00:00.000Z',
  };
  const round2: TermsProposal = {
    ...baseProposal,
    id: 'prop-2',
    proposed_by: 'parent-1',
    direction: 'parent',
    supersedes_id: 'prop-1',
    created_at: '2026-08-11T09:00:00.000Z',
  };

  it('walks supersedes_id back to the first round, newest first', () => {
    const chain = buildProposalChain([round2, round1], round2);
    expect(chain.map(p => p.id)).toEqual(['prop-2', 'prop-1']);
  });

  it('a first-round proposal is a chain of one', () => {
    expect(buildProposalChain([round1], baseProposal).map(p => p.id)).toEqual([
      'prop-1',
    ]);
  });

  it('stops rather than looping when a predecessor is missing or self-referential', () => {
    const orphan = { ...round2, supersedes_id: 'prop-missing' };
    expect(buildProposalChain([orphan], orphan).map(p => p.id)).toEqual([
      'prop-2',
    ]);
    const selfRef = { ...round2, supersedes_id: 'prop-2' };
    expect(buildProposalChain([selfRef], selfRef).map(p => p.id)).toEqual([
      'prop-2',
    ]);
  });
});

describe('proposalStateWord', () => {
  const opts = { counterpartyName: 'Marisol', timezone: 'UTC' };

  it('a first-round open proposal is Proposed, ochre, with its date', () => {
    const state = proposalStateWord(baseProposal, opts, fakeT);
    expect(state.variant).toBe('pending');
    expect(state.label).toBe('Proposed Aug 10');
  });

  it('an open counter is Countered — same ochre pill, a different word', () => {
    const state = proposalStateWord(
      {
        ...baseProposal,
        supersedes_id: 'prop-1',
        created_at: '2026-08-11T09:00:00.000Z',
      },
      opts,
      fakeT
    );
    expect(state.variant).toBe('pending');
    expect(state.label).toBe('Countered Aug 11');
  });

  it('accepted is Agreed, green, and names who it was agreed with', () => {
    const state = proposalStateWord(
      {
        ...baseProposal,
        status: 'accepted',
        responded_at: '2026-08-12T18:00:00.000Z',
      },
      opts,
      fakeT
    );
    expect(state.variant).toBe('confirmed');
    expect(state.label).toBe('Agreed with Marisol on Aug 12');
  });

  it('withdrawn is grey and stays legible — never deleted', () => {
    const state = proposalStateWord(
      {
        ...baseProposal,
        status: 'withdrawn',
        responded_at: '2026-08-11T10:00:00.000Z',
      },
      opts,
      fakeT
    );
    expect(state.variant).toBe('cancelled');
    expect(state.label).toBe('Withdrawn Aug 11');
  });

  it('never says "Pending approval", "Awaiting sign-off", "Accepted" or "Approved"', () => {
    const forbidden =
      /pending approval|awaiting sign-off|accepted|approved|contract active/i;
    for (const status of [
      'proposed',
      'countered',
      'accepted',
      'withdrawn',
    ] as const) {
      const { label } = proposalStateWord(
        { ...baseProposal, status, responded_at: '2026-08-12T18:00:00.000Z' },
        opts,
        fakeT
      );
      expect(label).not.toMatch(forbidden);
    }
  });
});

describe('proposalHistoryLabel', () => {
  it('always names the actor — daylight §5.2, never colour-only', () => {
    expect(
      proposalHistoryLabel(
        baseProposal,
        { authorName: 'Marisol', timezone: 'UTC' },
        fakeT
      )
    ).toBe('Proposed by Marisol · Aug 10');
    expect(
      proposalHistoryLabel(
        {
          ...baseProposal,
          supersedes_id: 'prop-1',
          created_at: '2026-08-11T09:00:00.000Z',
        },
        { authorName: 'you', timezone: 'UTC' },
        fakeT
      )
    ).toBe('Countered by you · Aug 11');
  });
});

/**
 * @module domains/pay/utils/__tests__/payTermsState
 *
 * The bug: terms accepted on 25 Nov that start on 26 Nov left `current` null,
 * and three screens said "No pay terms set yet" over an agreed row in the
 * history. One derivation, six states.
 */
import { describe, expect, it } from 'bun:test';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { payTermsState } from '../payTermsState';

const TODAY = '2026-11-25';

function row(id: string, valid_from: string): PayArrangement {
  return { id, valid_from, valid_to: null } as unknown as PayArrangement;
}
const proposal = { id: 'tp-1', status: 'proposed' } as unknown as TermsProposal;

describe('payTermsState', () => {
  it('(a) in effect now: shows current, nothing scheduled', () => {
    const current = row('now', '2026-11-21');
    const s = payTermsState({
      current,
      history: [current],
      openProposal: undefined,
      todayISO: TODAY,
    });
    expect(s.kind).toBe('inEffect');
    expect(s.shown?.id).toBe('now');
    expect(s.scheduled).toBeNull();
  });

  it('(b) agreed, starts later: a future row today+1 with no current shows the future row', () => {
    const s = payTermsState({
      current: null,
      history: [row('later', '2026-11-26')],
      openProposal: undefined,
      todayISO: TODAY,
    });
    expect(s.kind).toBe('startsLater');
    expect(s.shown?.id).toBe('later');
    // No "before" side to diff, and cancel-scheduled has nothing to revert to.
    expect(s.scheduled).toBeNull();
  });

  it('(b) with two future rows shows the EARLIEST, when terms first start', () => {
    const s = payTermsState({
      current: null,
      history: [row('later2', '2026-12-10'), row('later1', '2026-11-26')],
      openProposal: undefined,
      todayISO: TODAY,
    });
    expect(s.shown?.id).toBe('later1');
  });

  it('(c) in effect plus a scheduled change', () => {
    const current = row('now', '2026-11-21');
    const s = payTermsState({
      current,
      history: [row('next', '2026-12-01'), current],
      openProposal: undefined,
      todayISO: TODAY,
    });
    expect(s.kind).toBe('inEffect');
    expect(s.shown?.id).toBe('now');
    expect(s.scheduled?.id).toBe('next');
  });

  it('(d)/(e) an open round with no terms yet is none, and carries the round', () => {
    const s = payTermsState({
      current: null,
      history: [],
      openProposal: proposal,
      todayISO: TODAY,
    });
    expect(s.kind).toBe('none');
    expect(s.shown).toBeNull();
    expect(s.openProposal).toBe(proposal);
  });

  it('(d)/(e) an open round over future terms still shows them', () => {
    const s = payTermsState({
      current: null,
      history: [row('later', '2026-11-26')],
      openProposal: proposal,
      todayISO: TODAY,
    });
    expect(s.kind).toBe('startsLater');
    expect(s.openProposal).toBe(proposal);
  });

  it('(f) nothing at all', () => {
    const s = payTermsState({
      current: null,
      history: [],
      openProposal: undefined,
      todayISO: TODAY,
    });
    expect(s).toEqual({
      kind: 'none',
      shown: null,
      scheduled: null,
      openProposal: undefined,
    });
  });

  it('a past row the server no longer returns as current is none, not startsLater', () => {
    const s = payTermsState({
      current: null,
      history: [row('ended', '2026-01-01')],
      openProposal: undefined,
      todayISO: TODAY,
    });
    expect(s.kind).toBe('none');
  });
});

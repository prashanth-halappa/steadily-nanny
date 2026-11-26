/**
 * @module domains/pay/utils/__tests__/ackState
 * Covers §8.4's outranking rule and the empty/one-of-each cases the two
 * screens branch on.
 */
import { describe, expect, it } from 'bun:test';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import {
  acksWithAcceptance,
  hasSeenAck,
  resolveAckState,
  seenAckAt,
} from '../ackState';

const row = (
  kind: 'seen' | 'disagreed',
  created_at: string,
  note: string | null = null
) => ({
  id: `ack-${kind}-${created_at}`,
  arrangement_id: 'arr-1',
  carer_id: 'nanny-1',
  kind,
  note,
  created_at,
});

describe('resolveAckState', () => {
  it('no rows: nothing has been recorded', () => {
    expect(resolveAckState([])).toEqual({ kind: 'none' });
    expect(resolveAckState(undefined)).toEqual({ kind: 'none' });
  });

  it('a seen row reports the date it was recorded', () => {
    expect(resolveAckState([row('seen', '2026-08-11T09:00:00.000Z')])).toEqual({
      kind: 'seen',
      createdAt: '2026-08-11T09:00:00.000Z',
    });
  });

  it('a disagreement outranks a seen when both exist, and carries her note', () => {
    const state = resolveAckState([
      row('seen', '2026-08-11T09:00:00.000Z'),
      row('disagreed', '2026-08-12T09:00:00.000Z', 'The rate went down.'),
    ]);

    expect(state).toEqual({
      kind: 'disagreed',
      createdAt: '2026-08-12T09:00:00.000Z',
      note: 'The rate went down.',
    });
  });

  it('outranks even when the seen row is the newer of the two', () => {
    const state = resolveAckState([
      row('disagreed', '2026-08-10T09:00:00.000Z'),
      row('seen', '2026-08-12T09:00:00.000Z'),
    ]);

    expect(state.kind).toBe('disagreed');
  });

  // GOLDEN #25: `created_at` arrives in MIXED serialisations — Postgres emits
  // '…+00:00' (bare seconds when the fraction is zero) while client-written
  // rows carry `toISOString()`'s '.mmmZ'. A raw string compare ranks 'Z'
  // (0x5A) above '.' and '+', so the bare-'Z' row always wins newestOfKind
  // regardless of which instant is actually newer.
  it('orders mixed created_at serialisations by instant, not by string', () => {
    const state = resolveAckState([
      row('disagreed', '2026-08-12T09:00:00Z', 'the older note'),
      row('disagreed', '2026-08-12T09:00:00.500+00:00', 'the newer note'),
    ]);

    expect(state).toEqual({
      kind: 'disagreed',
      createdAt: '2026-08-12T09:00:00.500+00:00',
      note: 'the newer note',
    });
  });
});

// The bug this pair of functions exists to prevent: a nanny who had once
// pressed the secondary button was prompted to read her terms forever,
// because the prompt was gated on the WORD (which a disagreement outranks)
// rather than on the row.
describe('hasSeenAck / seenAckAt', () => {
  it('is true with BOTH rows, while the state word still reports the disagreement', () => {
    const acks = [
      row('disagreed', '2026-08-10T09:00:00.000Z', 'The rate went down.'),
      row('seen', '2026-08-12T09:00:00.000Z'),
    ];

    expect(hasSeenAck(acks)).toBe(true);
    expect(seenAckAt(acks)).toBe('2026-08-12T09:00:00.000Z');
    expect(resolveAckState(acks).kind).toBe('disagreed');
  });

  it('is false with no rows, and with a disagreement alone', () => {
    expect(hasSeenAck(undefined)).toBe(false);
    expect(hasSeenAck([])).toBe(false);
    expect(hasSeenAck([row('disagreed', '2026-08-10T09:00:00.000Z')])).toBe(
      false
    );
    expect(
      seenAckAt([row('disagreed', '2026-08-10T09:00:00.000Z')])
    ).toBeNull();
  });

  // GOLDEN #25, same reason as resolveAckState's: the date rendered next to
  // "Read" must be the latest INSTANT, not the highest string.
  it('reports the newest seen row by instant across mixed serialisations', () => {
    expect(
      seenAckAt([
        row('seen', '2026-08-12T09:00:00Z'),
        row('seen', '2026-08-12T09:00:00.500+00:00'),
      ])
    ).toBe('2026-08-12T09:00:00.500+00:00');
  });
});

/**
 * Accepting is reading. Rows accepted before the server recorded a `seen`
 * ack on acceptance (production: proposal f3c049f4 → arrangement 1d25a44e)
 * must not read "Not read yet".
 */
describe('acksWithAcceptance', () => {
  const ACCEPTED_AT = '2026-11-25T17:56:12.000Z';
  const accepted = (over: Partial<TermsProposal> = {}) =>
    ({
      id: 'tp-1',
      carer_id: 'nanny-1',
      status: 'accepted',
      responded_at: ACCEPTED_AT,
      accepted_arrangement_id: 'arr-1',
      ...over,
    }) as unknown as TermsProposal;

  it('an arrangement an accepted round created reads as seen on the acceptance instant', () => {
    const acks = acksWithAcceptance([], 'arr-1', [accepted()]);
    expect(resolveAckState(acks)).toEqual({
      kind: 'seen',
      createdAt: ACCEPTED_AT,
    });
    expect(seenAckAt(acks)).toBe(ACCEPTED_AT);
  });

  it('a real seen row wins, and nothing is added', () => {
    const real = [row('seen', '2026-11-26T08:00:00.000Z')];
    expect(acksWithAcceptance(real, 'arr-1', [accepted()])).toEqual(real);
  });

  it('a disagreement still outranks the acceptance', () => {
    const acks = acksWithAcceptance(
      [row('disagreed', '2026-11-26T08:00:00.000Z', 'Rate is wrong')],
      'arr-1',
      [accepted()]
    );
    expect(resolveAckState(acks).kind).toBe('disagreed');
    expect(seenAckAt(acks)).toBe(ACCEPTED_AT);
  });

  it('only the row the round CREATED, never another arrangement or an open round', () => {
    expect(acksWithAcceptance([], 'arr-2', [accepted()])).toEqual([]);
    expect(
      acksWithAcceptance([], 'arr-1', [accepted({ status: 'proposed' })])
    ).toEqual([]);
  });

  it('still loading stays loading', () => {
    expect(
      acksWithAcceptance(undefined, 'arr-1', [accepted()])
    ).toBeUndefined();
  });
});

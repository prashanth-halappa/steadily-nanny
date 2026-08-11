/**
 * @module domains/pay/utils/__tests__/ackState
 * Covers §8.4's outranking rule and the empty/one-of-each cases the two
 * screens branch on.
 */
import { describe, expect, it } from 'bun:test';
import { resolveAckState } from '../ackState';

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
});

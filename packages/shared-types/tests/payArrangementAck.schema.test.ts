/**
 * The ack/dissent wire contract (D-31, D-45). Two things pinned here:
 *  1. `kind` is exactly `'seen' | 'disagreed'` — the SQL check constraint's
 *     mirror (081_pay_arrangement_acks.sql).
 *  2. `note` is capped at 280 chars, matching §8.3.1's Textarea and the
 *     migration's `char_length(note) <= 280` constraint.
 */
import { describe, expect, it } from 'bun:test';
import {
  CreatePayArrangementAckRequestSchema,
  PAY_ARRANGEMENT_ACK_KINDS,
  PayArrangementAckSchema,
} from '../src/schemas/payArrangementAck.schema';

const VALID_ACK = {
  id: '11111111-1111-4111-8111-111111111111',
  arrangement_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  kind: 'seen' as const,
  note: null,
  created_at: '2026-08-11T09:00:00.000Z',
};

describe('PayArrangementAckSchema', () => {
  it('parses a seen row with a null note', () => {
    expect(PayArrangementAckSchema.parse(VALID_ACK)).toEqual(VALID_ACK);
  });

  it('parses a disagreed row carrying an optional note', () => {
    const row = {
      ...VALID_ACK,
      kind: 'disagreed' as const,
      note: 'The rate is wrong.',
    };
    expect(PayArrangementAckSchema.parse(row)).toEqual(row);
  });

  it('rejects a kind outside seen/disagreed', () => {
    expect(() =>
      PayArrangementAckSchema.parse({ ...VALID_ACK, kind: 'agreed' })
    ).toThrow();
  });

  it('the const-map matches the SQL check constraint literals', () => {
    expect(PAY_ARRANGEMENT_ACK_KINDS.SEEN).toBe('seen');
    expect(PAY_ARRANGEMENT_ACK_KINDS.DISAGREED).toBe('disagreed');
  });
});

describe('CreatePayArrangementAckRequestSchema', () => {
  it('accepts an empty body — note is optional', () => {
    expect(CreatePayArrangementAckRequestSchema.parse({})).toEqual({});
  });

  it('accepts a note up to 280 chars', () => {
    const note = 'x'.repeat(280);
    expect(CreatePayArrangementAckRequestSchema.parse({ note }).note).toBe(
      note
    );
  });

  it('refuses a note over 280 chars', () => {
    const note = 'x'.repeat(281);
    expect(() =>
      CreatePayArrangementAckRequestSchema.parse({ note })
    ).toThrow();
  });
});

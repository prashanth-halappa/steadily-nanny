import { describe, expect, it } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { isOutstandingCoverAsk } from '../shiftGrouping';

function shift(overrides: Partial<Shift>): Shift {
  return {
    id: 's',
    status: 'pending',
    kind: 'extra',
    carer_id: 'carer',
    cover_ask_expires_at: '2026-12-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

describe('isOutstandingCoverAsk (mirrors shiftCommandService.isOutstandingCoverAsk + its pending gate)', () => {
  it('a pending extra or cover ask with a carer and a fuse is outstanding', () => {
    expect(isOutstandingCoverAsk(shift({}))).toBe(true);
    expect(isOutstandingCoverAsk(shift({ kind: 'cover' }))).toBe(true);
  });

  it('anything the server would refuse to withdraw is not', () => {
    expect(isOutstandingCoverAsk(shift({ status: 'confirmed' }))).toBe(false);
    expect(isOutstandingCoverAsk(shift({ cover_ask_expires_at: null }))).toBe(
      false
    );
    expect(isOutstandingCoverAsk(shift({ carer_id: null }))).toBe(false);
    expect(isOutstandingCoverAsk(shift({ kind: 'recurring' }))).toBe(false);
    expect(isOutstandingCoverAsk(shift({ kind: 'parent_cover' }))).toBe(false);
  });
});

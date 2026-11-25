/**
 * `arrangementEffectiveOn` must pick exactly the row the server's
 * `payArrangementRepo.effectiveOn` picks: `valid_from <= d`, `valid_to` null
 * or INCLUSIVE `>= d`, first of the server's newest-first history.
 */
import { describe, expect, it } from 'bun:test';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { arrangementEffectiveOn } from '../usePayArrangementOn';

function row(
  id: string,
  valid_from: string,
  valid_to: string | null = null
): PayArrangement {
  return { id, valid_from, valid_to } as unknown as PayArrangement;
}

describe('arrangementEffectiveOn', () => {
  it('returns the arrangement that starts ON the date, not null (the bug: accepted 11/25, valid from 11/26)', () => {
    const history = [row('a', '2026-11-26')];
    expect(arrangementEffectiveOn(history, '2026-11-26')?.id).toBe('a');
    expect(arrangementEffectiveOn(history, '2026-11-25')).toBeNull();
  });

  it('takes the first eligible row of the newest-first history', () => {
    const history = [
      row('future', '2026-12-01'),
      row('newer', '2026-11-10'),
      row('older', '2026-10-01'),
    ];
    expect(arrangementEffectiveOn(history, '2026-11-20')?.id).toBe('newer');
    expect(arrangementEffectiveOn(history, '2026-11-01')?.id).toBe('older');
    expect(arrangementEffectiveOn(history, '2026-12-01')?.id).toBe('future');
  });

  it('treats valid_to as inclusive and skips a row once it is behind the date', () => {
    const history = [row('ended', '2026-10-01', '2026-11-15')];
    expect(arrangementEffectiveOn(history, '2026-11-15')?.id).toBe('ended');
    expect(arrangementEffectiveOn(history, '2026-11-16')).toBeNull();
  });
});

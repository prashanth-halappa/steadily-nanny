/**
 * @module domains/schedule/__tests__/clashWarnings.test
 */
import { describe, expect, it } from 'bun:test';
import { CLASH_WARNING_KINDS } from '@steadily-nanny/shared-types/schemas/me.schema';
import { clashWarningMessageKey } from '../utils/clashWarnings';

describe('clashWarningMessageKey', () => {
  it('maps kinds to i18n keys', () => {
    expect(
      clashWarningMessageKey({ kind: CLASH_WARNING_KINDS.BUSY_OVERLAP })
    ).toBe('clash.busyOverlap');
    expect(
      clashWarningMessageKey({
        kind: CLASH_WARNING_KINDS.OUTSIDE_AVAILABILITY,
      })
    ).toBe('clash.outsideAvailability');
  });
});

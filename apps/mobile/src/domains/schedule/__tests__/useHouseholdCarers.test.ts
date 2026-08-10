/**
 * @module domains/schedule/__tests__/useHouseholdCarers.test
 *
 * The carer list is nanny-only. Every server-side carer gate rejects helpers
 * (`shiftChangeRequestCommandService.assertCarerRole` → 400
 * `INVALID_SHIFT_CARER`), so a helper chip in the picker is a dead end — and a
 * stray helper also inflates the `carers.length === 1` check that decides
 * whether the cover CTA names the nanny.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(import.meta.dir, '../hooks/useHouseholdCarers.ts'),
  'utf8'
);

describe('useHouseholdCarers carer roles', () => {
  it('treats nanny as the only carer role', () => {
    expect(source).toContain("const CARER_ROLES = ['nanny'] as const;");
  });
});

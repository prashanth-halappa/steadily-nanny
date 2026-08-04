/**
 * @module app/(private)/settings/__tests__/emptyStateTestIds.test
 *
 * Source-inspection (Pattern A, docs/09-TESTING.md §5) — these `EmptyState`
 * usages carried no `testID`, so no Maestro flow could assert them. Colocated
 * in `__tests__/`, never a `*.test.ts` dropped next to a route file
 * (GOLDEN-FIXES.md #8).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

async function readRoute(file: string): Promise<string> {
  return Bun.file(join(__dirname, file)).text();
}

describe('settings/carer-availability empty states', () => {
  let source: string;
  beforeAll(async () => {
    source = await readRoute('../carer-availability.tsx');
  });

  it('wires testIDs for both the no-nanny and no-availability-rows empty states', () => {
    expect(source).toContain('testID="carer-availability-empty"');
    expect(source).toContain('testID="carer-availability-none"');
  });
});

describe('settings/household-time-off empty state', () => {
  let source: string;
  beforeAll(async () => {
    source = await readRoute('../household-time-off.tsx');
  });

  it('wires a testID for the no-time-off empty state', () => {
    expect(source).toContain('testID="household-time-off-empty"');
  });
});

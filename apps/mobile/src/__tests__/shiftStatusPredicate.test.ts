import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';

/**
 * GUARDRAIL: never hand-roll "does this shift count?" with `status !== 'cancelled'`,
 * `status === 'cancelled'`, or `status !== 'declined'`. Those predicates wrongly admit
 * `declined` and `draft` shifts — a declined shift was once shown to a parent as their
 * nanny's plan for the day and to the nanny as a shift she was due at.
 *
 * The correct answer is one of TWO shared-types constants, and which one turns
 * on the question the call site is actually asking (D-22):
 *   - `COVERING_SHIFT_STATUSES`  — "does this shift PROVIDE COVER?" A pending
 *     ask is not cover, so it is absent. Parent-facing "who has the children".
 *   - `SCHEDULED_SHIFT_STATUSES` — "is this shift REAL on someone's schedule /
 *     clockable / on her widget?" A pending ask is, so it is present.
 *   import { … } from '@steadily-nanny/shared-types/uncoveredCare';
 * Prefer a module-scope `Set` when filtering in a loop.
 */
/**
 * ALLOWLIST — these match the pattern but are not "does this shift count as
 * cover?" checks. Each needs a reason; a new entry without one is a smell.
 * Verified individually, not assumed.
 */
const ALLOWED: Record<string, string> = {
  'src/domains/schedule/utils/uncoveredDisplay.ts':
    'Cause inference: it deliberately LOOKS FOR the cancelled/declined shift ' +
    'overlapping a gap in order to name why the gap exists. Excluding those ' +
    'statuses here would delete the feature.',
  'src/domains/schedule/utils/timeOffOverlap.ts':
    'Operates on carer time-off rows, not shifts — a different entity that ' +
    'happens to share the word "cancelled".',
  'src/domains/schedule/components/ShiftDetailScreen.tsx':
    'Gates whether to OFFER the "Cancel shift" button, not whether the shift ' +
    'counts as cover. Not offering cancel on an already-cancelled shift is right.',
};

describe('guardrail: shift status predicates use COVERING_SHIFT_STATUSES', () => {
  it('never hand-rolls cancelled/declined status comparisons in shift-count surfaces', async () => {
    const handRolledStatus =
      /\.\s*status\s*(?:!==\s*['"]cancelled['"]|===\s*['"]cancelled['"]|!==\s*['"]declined['"])/;
    const offenders: string[] = [];

    const scanGlobs = [
      'src/domains/today/**/*.{ts,tsx}',
      'src/domains/schedule/**/*.{ts,tsx}',
      'src/lib/widgetSnapshot.ts',
      'src/lib/useWidgetSnapshotSync.ts',
    ];

    for (const pattern of scanGlobs) {
      const glob = new Glob(pattern);
      for await (const file of glob.scan({
        cwd: process.cwd(),
        absolute: true,
      })) {
        if (file.includes('/__tests__/') || /\.test\.[tj]sx?$/.test(file)) {
          continue;
        }
        const relative = file.slice(process.cwd().length + 1);
        if (ALLOWED[relative]) continue;
        const content = readFileSync(file, 'utf8');
        if (handRolledStatus.test(content)) offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * today.json key contract — renamed keys reflect the reader, not the author;
 * new keys must stay in en/es parity with matching placeholders.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE_ROOT = join(import.meta.dir, '../../..');
const enToday = JSON.parse(
  readFileSync(join(import.meta.dir, '../locales/en/today.json'), 'utf8')
) as Record<string, unknown>;
const esToday = JSON.parse(
  readFileSync(join(import.meta.dir, '../locales/es/today.json'), 'utf8')
) as Record<string, unknown>;
const enSchedule = JSON.parse(
  readFileSync(join(import.meta.dir, '../locales/en/schedule.json'), 'utf8')
) as Record<string, unknown>;

const COVERAGE_NEW_KEYS = [
  'coverage.gap.titleOne',
  'coverage.gap.titleMany',
  'coverage.gap.windowLine',
  'coverage.gap.windowAllDay',
  'coverage.gap.windowFallback',
  'coverage.gap.andMore',
  'coverage.plan.booked',
  'coverage.plan.arrivingIn_one',
  'coverage.plan.arrivingIn_other',
  'coverage.plan.here',
  'coverage.plan.until',
  'coverage.plan.left',
  'coverage.plan.youCovering',
  'coverage.plan.parentCovering',
  'coverage.status.confirmed',
  'coverage.status.waiting',
  'coverage.status.declined',
  'coverage.asked',
  'awaitingYourAnswer',
  'clockedIntoHousehold',
  'weekLine',
] as const;

const DELETED_TODAY_KEYS = [
  'todayCoverTitle',
  'cover.covered.title',
  'cover.covered.variant0',
  'cover.covered.variant1',
  'cover.covered.variant2',
  'cover.covered.variant3',
  'liveActivity.noScheduledShift',
] as const;

const SCHEDULE_COVER_PINS: Record<string, string> = {
  'cover.iveGotIt': "I've got it",
  'cover.allCovered': 'Everything you asked for is booked.',
  'cover.hoursWrong': 'These hours are wrong',
  'cover.undoCovering': 'Undo',
  'cover.coveringToast': 'Marked as covered by you',
  'cover.undoneToast': "Removed — that time isn't covered again.",
};

const OLD_KEYS = [
  'nannyNoShiftTitle',
  'nannyNoShiftBody',
  'handoff.tapHintForNanny',
  'handoff.tapHintForParent',
] as const;

function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function hasPath(obj: Record<string, unknown>, path: string): boolean {
  return getAtPath(obj, path) !== undefined;
}

function extractPlaceholders(value: string): string[] {
  const matches = value.matchAll(/\{\{(\w+)\}\}/g);
  return [...matches].map(m => m[1] ?? '').sort();
}

function collectStringLeaves(
  value: unknown,
  prefix = ''
): Array<{ path: string; value: string }> {
  if (typeof value === 'string') {
    return prefix ? [{ path: prefix, value }] : [];
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  const leaves: Array<{ path: string; value: string }> = [];
  for (const key of Object.keys(record).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    leaves.push(...collectStringLeaves(record[key], path));
  }
  return leaves;
}

let sourceFilesReferencingOldKeys: string[] = [];

beforeAll(async () => {
  const glob = new Bun.Glob('{src,lib}/**/*.{ts,tsx}');
  const offenders: string[] = [];
  // Built from OLD_KEYS so the list stays the single source of truth.
  const pattern = new RegExp(
    OLD_KEYS.map(key => key.split('.').at(-1)).join('|')
  );

  for await (const relative of glob.scan({
    cwd: MOBILE_ROOT,
    onlyFiles: true,
  })) {
    if (
      relative === 'src/i18n/__tests__/today-key-contract.test.ts' ||
      relative.includes('__tests__') ||
      relative.includes('.test.')
    ) {
      continue;
    }
    const source = await Bun.file(join(MOBILE_ROOT, relative)).text();
    if (pattern.test(source)) {
      offenders.push(relative);
    }
  }
  sourceFilesReferencingOldKeys = offenders.sort();
});

describe('today.json key contract', () => {
  it('parentNoCover keys exist; nannyNoShift keys are gone', () => {
    for (const locale of [enToday, esToday] as const) {
      expect(hasPath(locale, 'parentNoCoverTitle')).toBe(true);
      expect(hasPath(locale, 'parentNoCoverBody')).toBe(true);
      expect(hasPath(locale, 'nannyNoShiftTitle')).toBe(false);
      expect(hasPath(locale, 'nannyNoShiftBody')).toBe(false);
    }
  });

  it('handoff tapHint keys are renamed for the editor audience', () => {
    for (const locale of [enToday, esToday] as const) {
      expect(hasPath(locale, 'handoff.tapHintParentEditor')).toBe(true);
      expect(hasPath(locale, 'handoff.tapHintNannyEditor')).toBe(true);
      expect(hasPath(locale, 'handoff.tapHintForNanny')).toBe(false);
      expect(hasPath(locale, 'handoff.tapHintForParent')).toBe(false);
    }
  });

  it('tapHint values were not swapped during the rename', () => {
    const parentEditor = getAtPath(
      enToday,
      'handoff.tapHintParentEditor'
    ) as string;
    const nannyEditor = getAtPath(
      enToday,
      'handoff.tapHintNannyEditor'
    ) as string;

    expect(parentEditor).toContain('your nanny');
    expect(nannyEditor).toContain('your family');
  });

  it('declinedToday and cover.noNeed keys exist with matching placeholders', () => {
    const paths = [
      'declinedToday',
      'declinedTodayHint',
      'cover.noNeed.title',
      'cover.noNeed.body',
    ] as const;

    for (const path of paths) {
      expect(hasPath(enToday, path)).toBe(true);
      expect(hasPath(esToday, path)).toBe(true);

      const enValue = getAtPath(enToday, path) as string;
      const esValue = getAtPath(esToday, path) as string;
      expect(extractPlaceholders(enValue)).toEqual(
        extractPlaceholders(esValue)
      );
    }
  });

  it('no source file references the four old key names', () => {
    expect(sourceFilesReferencingOldKeys).toEqual([]);
  });

  it('coverage vocabulary keys exist in en and es with matching placeholders', () => {
    for (const path of COVERAGE_NEW_KEYS) {
      expect(hasPath(enToday, path)).toBe(true);
      expect(hasPath(esToday, path)).toBe(true);

      const enValue = getAtPath(enToday, path) as string;
      const esValue = getAtPath(esToday, path) as string;
      expect(extractPlaceholders(enValue)).toEqual(
        extractPlaceholders(esValue)
      );
    }
  });

  it('verdict keys removed from both today locales', () => {
    for (const path of DELETED_TODAY_KEYS) {
      expect(hasPath(enToday, path)).toBe(false);
      expect(hasPath(esToday, path)).toBe(false);
    }
  });

  it('no en coverage.* value uses the retired word "covered"', () => {
    const coverageLeaves = collectStringLeaves(enToday.coverage, 'coverage');
    const offenders = coverageLeaves.filter(leaf =>
      /\bcovered\b/i.test(leaf.value)
    );
    expect(offenders).toEqual([]);
  });

  it('schedule cover praise-pinned strings are unchanged', () => {
    for (const [path, expected] of Object.entries(SCHEDULE_COVER_PINS)) {
      expect(getAtPath(enSchedule, path)).toBe(expected);
    }
  });
});

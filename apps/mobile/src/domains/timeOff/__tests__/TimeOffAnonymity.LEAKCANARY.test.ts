/**
 * @module domains/timeOff/__tests__/TimeOffAnonymity.LEAKCANARY.test
 *
 * TIER0-CX-SPEC.md §5.2: `/settings/time-off` is a CROSS-FAMILY surface —
 * `carer_time_off` carries no household reference by design
 * (011_availability.sql) — so the paid marker on this screen must never
 * name a household, and must never carry a per-family amount. Pattern
 * mirrors `domains/schedule/__tests__/CrossFamilyRhythmView.test.ts`
 * (source inspection, not a runtime prop-drilling test, because the leak
 * this guards against is a future edit adding `household.name` back in,
 * not a value already flowing through today's props).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const hookPath = join(__dirname, '../hooks/usePaidFamilyCounts.ts');
const rowPath = join(__dirname, '../components/TimeOffRow.tsx');
const screenPath = join(__dirname, '../components/TimeOffScreen.tsx');

let hookSource: string;
let rowSource: string;
let screenSource: string;

const LEAKCANARY = 'LEAKCANARY';

beforeAll(async () => {
  hookSource = await Bun.file(hookPath).text();
  rowSource = await Bun.file(rowPath).text();
  screenSource = await Bun.file(screenPath).text();
});

describe('usePaidFamilyCounts source', () => {
  it('never reads or forwards a household NAME — id only', () => {
    expect(hookSource).not.toContain('.name');
    expect(hookSource).not.toContain('household_name');
    expect(hookSource).not.toContain('householdName');
  });

  it('returns counts keyed by time-off id, never a household id or name', () => {
    expect(hookSource).toContain('Map<string, number>');
  });

  it('does not contain LEAKCANARY fixture strings', () => {
    expect(hookSource).not.toContain(LEAKCANARY);
  });
});

describe('TimeOffRow source (renders the cross-family marker)', () => {
  it('never renders a household name or per-family amount on this row', () => {
    expect(rowSource).not.toContain('household.name');
    expect(rowSource).not.toContain('{household}');
    expect(rowSource).not.toContain('minutes}h');
    expect(rowSource).not.toContain('balance_minutes');
  });

  it('the paid marker is driven ONLY by a count, never a household object', () => {
    expect(rowSource).toContain('paidFamilyCount');
    expect(rowSource).not.toContain('householdId');
    expect(rowSource).not.toContain('household_id');
  });

  it('does not contain LEAKCANARY fixture strings', () => {
    expect(rowSource).not.toContain(LEAKCANARY);
  });
});

describe('TimeOffScreen source (wires the anonymised counts in)', () => {
  it('never passes a household object or name into TimeOffRow — id-free, name-free', () => {
    expect(screenSource).not.toContain('household.name');
    expect(screenSource).not.toContain('householdName');
    expect(screenSource).toContain('paidFamilyCounts');
  });

  it('does not contain LEAKCANARY fixture strings', () => {
    expect(screenSource).not.toContain(LEAKCANARY);
  });
});

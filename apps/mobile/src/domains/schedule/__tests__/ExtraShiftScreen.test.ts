/**
 * @module domains/schedule/__tests__/ExtraShiftScreen.test
 * Pattern A — native DateTimePicker cannot render under bun:test.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/ExtraShiftScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(screenPath).text();
});

describe('ExtraShiftScreen', () => {
  it('uses native pickers and disables submit until the form is valid', () => {
    expect(source).toContain('TimeRangePicker');
    expect(source).toContain('DateTimePicker');
    expect(source).toContain('isExtraShiftFormValid');
    expect(source).toContain('disabled={!canSubmit}');
    expect(source).not.toMatch(/catch\s*\{\s*return;\s*\}/);
  });

  it('lets the parent pick carer and children', () => {
    expect(source).toContain('useHouseholdCarers');
    expect(source).toContain('useChildren');
    expect(source).toContain('carer_id: carerId');
    expect(source).toContain('child_ids');
  });
});

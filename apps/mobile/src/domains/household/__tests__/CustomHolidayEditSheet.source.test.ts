/**
 * @module domains/household/__tests__/CustomHolidayEditSheet.source.test
 *
 * Source-inspection only (docs/09-TESTING.md §5 Pattern A) —
 * `@react-native-community/datetimepicker` ships raw Flow-typed `.js`
 * source `bun:test`'s parser cannot handle, and `mock.module()` cannot
 * prevent that parse attempt (same as `ExpenseDateField.test.tsx`).
 * Behaviour lives in the dependency-free `customHolidayForm.ts` and IS
 * genuinely unit-tested. This file only characterizes that the sheet
 * wires BottomSheetBase + the existing date-field pattern correctly.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(
  __dirname,
  '../components/CustomHolidayEditSheet.tsx'
);
let source: string;

it('loads the source file', async () => {
  source = await Bun.file(componentPath).text();
  expect(source.length).toBeGreaterThan(0);
});

describe('CustomHolidayEditSheet', () => {
  it('exports the component', async () => {
    source = source ?? (await Bun.file(componentPath).text());
    expect(source).toContain('export function CustomHolidayEditSheet');
  });

  it('uses BottomSheetBase, never a bare RN Modal (GOLDEN-FIXES #1)', () => {
    expect(source).toContain('BottomSheetBase');
    expect(source).toContain("from '@/src/components/custom/BottomSheetBase'");
    expect(source).not.toMatch(
      /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*'react-native'/
    );
  });

  it('reuses ExpenseDateField\'s date helpers and native picker, mode="date"', () => {
    expect(source).toContain(
      "from '@/src/domains/expenses/components/ExpenseDateField.utils'"
    );
    expect(source).toContain('parseDate');
    expect(source).toContain('formatDate');
    expect(source).toContain("from '@/src/components/ui/date-time-field'");
    expect(source).toContain('mode="date"');
    expect(source).not.toContain('mode="time"');
  });

  it('never calls onChange with a raw Date — only formatted yyyy-mm-dd strings', () => {
    expect(source).toContain('formatDate(date)');
    expect(source).not.toMatch(/onChange\(\s*date\s*\)/);
  });

  it('delegates add/remove/validate to the pure customHolidayForm helpers', () => {
    expect(source).toContain('addCustomHolidayDate');
    expect(source).toContain('removeCustomHolidayDate');
    expect(source).toContain('normalizeCustomHolidayName');
    expect(source).toContain('validateCustomHoliday');
    expect(source).toContain("from '../utils/customHolidayForm'");
  });

  it('wires name, date-picker, add/remove, and save testIDs', () => {
    expect(source).toContain('custom-holiday-edit-sheet');
    expect(source).toContain('custom-holiday-name');
    expect(source).toContain('custom-holiday-add-date');
    expect(source).toContain('custom-holiday-save');
    expect(source).toContain('custom-holiday-date-');
    expect(source).toContain('custom-holiday-remove-date-');
  });

  it('localizes through household namespace custom-day keys', () => {
    expect(source).toContain("useTranslation('household')");
    expect(source).toContain("t('holidays.custom.editTitle')");
    expect(source).toContain("t('holidays.custom.nameLabel')");
    expect(source).toContain("t('holidays.custom.datesLabel')");
    expect(source).toContain("t('holidays.custom.addDate')");
    expect(source).toContain("t('holidays.custom.removeDate')");
    expect(source).toContain("t('holidays.custom.datesRequired')");
  });
});

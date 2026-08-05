/**
 * @module domains/expenses/components/__tests__/ExpenseDateField.test
 * Source-inspection only (docs/09-TESTING.md §5 Pattern A) —
 * `@react-native-community/datetimepicker` ships raw Flow-typed `.js`
 * source `bun:test`'s parser cannot handle, and `mock.module()` cannot
 * prevent that parse attempt (same as `TimeOffDateRangePicker.test.tsx`).
 * The pure "yyyy-mm-dd" logic (parseDate/formatDate/isOnOrBeforeToday)
 * lives in the dependency-free `ExpenseDateField.utils.ts` and IS
 * genuinely render-free unit tested — see `ExpenseDateField.utils.test.ts`.
 * This file only characterizes that the component wires that logic up
 * correctly: exports, testIDs, date mode, and the refuse-don't-silently-
 * clamp contract for a future date.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../ExpenseDateField.tsx');
let source: string;

it('loads the source file', async () => {
  source = await Bun.file(componentPath).text();
  expect(source.length).toBeGreaterThan(0);
});

describe('ExpenseDateField', () => {
  it('exports the component', async () => {
    source = source ?? (await Bun.file(componentPath).text());
    expect(source).toContain('export function ExpenseDateField');
  });

  it('uses mode="date", never a time picker', async () => {
    expect(source).toContain('mode="date"');
  });

  it('caps the picker at today via maximumDate', async () => {
    expect(source).toContain('maximumDate={parseDate(todayISO)}');
  });

  it('refuses a future date rather than clamping it silently', async () => {
    expect(source).toContain('isOnOrBeforeToday(next, todayISO)');
    expect(source).toContain('setShowError(true)');
    expect(source).toContain('return;');
  });

  it('wires the date-field and error testIDs', async () => {
    expect(source).toContain('expense-date-field');
    expect(source).toContain('${baseTestID}-picker');
    expect(source).toContain('${baseTestID}-error');
  });
});

/**
 * @module domains/timeOff/__tests__/TimeOffDateRangePicker.test
 *
 * Source-inspection tests (docs/09-TESTING.md §5 Pattern A) for
 * TimeOffDateRangePicker's wiring — NOT a render test. Same reason as
 * `time-range-picker.test.tsx`: `@react-native-community/datetimepicker`
 * ships raw Flow-typed `.js` source `bun:test`'s parser cannot handle, and
 * `mock.module()` cannot prevent that parse attempt.
 *
 * The pure "yyyy-mm-dd" logic (parseDate/formatDate/isEndOnOrAfterStart)
 * lives in the dependency-free TimeOffDateRangePicker.utils.ts and IS
 * genuinely render-free unit tested — see TimeOffDateRangePicker.utils.test.ts.
 * This file only characterizes that the component wires that logic up
 * correctly: exports, testIDs, date mode, and the refuse-don't-swap contract.
 */

import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(
  __dirname,
  '../components/TimeOffDateRangePicker.tsx'
);
let source: string;

describe('TimeOffDateRangePicker source', () => {
  it('reads the component source', async () => {
    source = await Bun.file(componentPath).text();
    expect(source.length).toBeGreaterThan(0);
  });

  it('exports the component', () => {
    expect(source).toContain('export function TimeOffDateRangePicker');
  });

  it('imports the pure "yyyy-mm-dd" helpers from the dependency-free utils module', () => {
    expect(source).toContain('formatDate');
    expect(source).toContain('isEndOnOrAfterStart');
    expect(source).toContain('parseDate');
    expect(source).toContain("from './TimeOffDateRangePicker.utils'");
  });

  it('uses the native picker in calendar-date mode, not time mode', () => {
    expect(source).toContain('mode="date"');
    expect(source).not.toContain('mode="time"');
  });

  it('wires start/end/error testIDs off the base testID', () => {
    expect(source).toContain('`${baseTestID}-start`');
    expect(source).toContain('`${baseTestID}-end`');
    expect(source).toContain('`${baseTestID}-error`');
  });

  it('guards BOTH handlers with isEndOnOrAfterStart before calling onChange', () => {
    const guardCount = (source.match(/if \(!isEndOnOrAfterStart/g) ?? [])
      .length;
    expect(guardCount).toBe(2);
  });

  it('never calls onChange with a raw Date — only formatted "yyyy-mm-dd" strings', () => {
    expect(source).not.toMatch(/onChange\(\s*date/);
    expect(source).toContain('onChange(nextStart, end)');
    expect(source).toContain('onChange(start, nextEnd)');
  });

  it('never silently swaps start and end on rejection', () => {
    expect(source).not.toContain('onChange(end, start)');
    expect(source).not.toContain('onChange(nextEnd, nextStart)');
    // The refuse path must return early instead of calling onChange at all.
    expect(source).toMatch(/Refuse[\s\S]{0,150}return;/);
  });
});

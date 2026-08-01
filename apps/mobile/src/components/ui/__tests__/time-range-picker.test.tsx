/**
 * @module TimeRangePickerTests
 *
 * Source-inspection tests (docs/09-TESTING.md §5 Pattern A) for the
 * TimeRangePicker component's wiring — NOT a render test.
 *
 * Why: `@react-native-community/datetimepicker` ships raw Flow-typed `.js`
 * source with no pre-built dist. `bun:test`'s parser cannot parse it (fails
 * on `import type {...} from './types'` inside a plain `.js` file), and
 * `mock.module()` does not prevent that parse attempt — verified directly:
 * it fails identically whether the package is mocked by its bare specifier
 * or by its fully-resolved absolute path, because Bun attempts to parse the
 * real file before the mock can take effect. So importing/rendering
 * time-range-picker.tsx under bun:test is not possible in this environment.
 *
 * The pure "HH:MM" logic (parseTime/formatTime/isEndAfterStart) lives in
 * the dependency-free time-range-picker.utils.ts and IS genuinely
 * render-free unit tested — see time-range-picker.utils.test.ts. This file
 * only characterizes that the component wires that logic up correctly:
 * exports, testIDs, 24-hour mode, and the refuse-don't-swap contract.
 */

import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../time-range-picker.tsx');
let source: string;

describe('TimeRangePicker source', () => {
  it('reads the component source', async () => {
    source = await Bun.file(componentPath).text();
    expect(source.length).toBeGreaterThan(0);
  });

  it('exports the component', () => {
    expect(source).toContain('export function TimeRangePicker');
  });

  it('imports the pure HH:MM helpers from the dependency-free utils module', () => {
    expect(source).toContain('formatTime');
    expect(source).toContain('isEndAfterStart');
    expect(source).toContain('parseTime');
    expect(source).toContain("from './time-range-picker.utils'");
  });

  it('uses the native picker in 24-hour time mode', () => {
    expect(source).toContain('mode="time"');
    expect(source).toContain('is24Hour');
  });

  it('wires start/end/error testIDs off the base testID', () => {
    expect(source).toContain('`${baseTestID}-start`');
    expect(source).toContain('`${baseTestID}-end`');
    expect(source).toContain('`${baseTestID}-error`');
  });

  it('guards BOTH handlers with isEndAfterStart before calling onChange', () => {
    const guardCount = (source.match(/if \(!isEndAfterStart/g) ?? []).length;
    expect(guardCount).toBe(2);
  });

  it('never calls onChange with a raw Date — only formatted "HH:MM" strings', () => {
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

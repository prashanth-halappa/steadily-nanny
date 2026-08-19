/**
 * @module domains/pay/components/__tests__/EffectiveDateField.test
 * Source-inspection plus dependency-free unit tests (docs/09-TESTING.md §5
 * Pattern A). `@react-native-community/datetimepicker` ships raw Flow-typed
 * `.js` source `bun:test` cannot parse, and `mock.module()` cannot prevent
 * that parse attempt, so the component itself is never render-tested here.
 *
 * The real logic stays in `EffectiveDateField.utils.ts` and IS unit-tested
 * below; the component checks only characterize the expected wiring:
 * export, native date mode, stable Maestro testID, and the existing pay-form
 * validation/hint predicates remaining in place.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  formatDate,
  parseDate,
  shouldShowBackdatingHint,
} from '../EffectiveDateField.utils';

const componentPath = join(__dirname, '../EffectiveDateField.tsx');
let source: string;

it('loads the source file', async () => {
  source = await Bun.file(componentPath).text();
  expect(source.length).toBeGreaterThan(0);
});

describe('EffectiveDateField source wiring', () => {
  it('exports the component', async () => {
    source = source ?? (await Bun.file(componentPath).text());
    expect(source).toContain('export function EffectiveDateField');
  });

  it('uses the native date picker in date mode', async () => {
    expect(source).toContain(
      "import DateTimePicker from '@react-native-community/datetimepicker';"
    );
    expect(source).toContain('mode="date"');
  });

  it('keeps the existing Maestro date-input testID on the picker', async () => {
    expect(source).toContain('testID={`${testIDPrefix}-date-input`}');
  });

  it('keeps pay-form validation and hint predicates in place', async () => {
    expect(source).toContain('isValidCalendarDate');
    expect(source).toContain('isBeyondFutureHorizon');
    expect(source).toContain('changeSheet.dateInvalid');
    expect(source).toContain('changeSheet.dateTooFarAhead');
    expect(source).toContain('changeSheet.backdatingHint');
    expect(source).not.toContain('Input');
  });
});

describe('EffectiveDateField utils', () => {
  it('parses a yyyy-mm-dd string at local midnight', () => {
    const parsed = parseDate('2026-04-05');

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(3);
    expect(parsed.getDate()).toBe(5);
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getMinutes()).toBe(0);
    expect(parsed.getSeconds()).toBe(0);
    expect(parsed.getMilliseconds()).toBe(0);
  });

  it('formats a Date back to yyyy-mm-dd', () => {
    const date = new Date(2026, 3, 5, 16, 12, 9, 8);

    expect(formatDate(date)).toBe('2026-04-05');
  });

  it('shows the backdating hint only for valid past dates', () => {
    expect(shouldShowBackdatingHint('2026-04-04', '2026-04-05')).toBe(true);
    expect(shouldShowBackdatingHint('2026-04-05', '2026-04-05')).toBe(false);
    expect(shouldShowBackdatingHint('2026-04-06', '2026-04-05')).toBe(false);
    expect(shouldShowBackdatingHint('', '2026-04-05')).toBe(false);
  });
});

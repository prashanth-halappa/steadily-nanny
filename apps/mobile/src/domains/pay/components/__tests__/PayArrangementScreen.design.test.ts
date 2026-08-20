/**
 * @module domains/pay/components/__tests__/PayArrangementScreen.design
 *
 * Source-inspection pins for PayArrangementScreen design-contract defects
 * (S8.5 / 01-LAWS). Whitespace-insensitive — Biome may re-wrap long lines.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../PayArrangementScreen.tsx');
let flat: string;

beforeAll(async () => {
  const src = await Bun.file(screenPath).text();
  flat = src.replace(/\s+/g, ' ');
});

describe('PayArrangementScreen design — S8.5 / 01-LAWS', () => {
  it('8: carer picker run is one ListGroup; rows drop elevation/rounding/bg', () => {
    expect(flat).toContain('testID="pay-carer-picker"');
    const pickerIdx = flat.indexOf('testID="pay-carer-picker"');
    const pickerWindow = flat.slice(pickerIdx - 40, pickerIdx + 200);
    expect(pickerWindow).toContain('<ListGroup');

    // CarerPickerRow itself must not lift separately.
    const rowIdx = flat.indexOf('testID={`pay-carer-picker-${carer.user_id}`}');
    expect(rowIdx).toBeGreaterThan(-1);
    const rowWindow = flat.slice(rowIdx, rowIdx + 450);
    expect(rowWindow).not.toContain('rounded-row');
    expect(rowWindow).not.toContain('bg-card');
    expect(rowWindow).not.toContain('elevation.row');

    // pay-open-proposal-row stays a single lifted row (not part of this fix).
    expect(flat).toContain('testID="pay-open-proposal-row"');
    const openIdx = flat.indexOf('testID="pay-open-proposal-row"');
    const openWindow = flat.slice(openIdx, openIdx + 200);
    expect(openWindow).toContain('rounded-row');
    expect(openWindow).toContain('elevation.row');
  });

  it('9: change-terms button inside L3 card is variant="ghost"', () => {
    expect(flat).toContain('testID="pay-change-terms-button"');
    const idx = flat.indexOf('testID="pay-change-terms-button"');
    const window = flat.slice(idx, idx + 160);
    expect(window).toContain('variant="ghost"');
    expect(window).toContain('onPress={() => setSheetOpen(true)}');
  });

  it('10: History heading leads; append-only note follows (S8.5)', () => {
    const headingIdx = flat.indexOf("t('historyHeading')");
    const noteIdx = flat.indexOf("t('appendOnlyNote')");
    expect(headingIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(-1);
    expect(headingIdx).toBeLessThan(noteIdx);
  });

  it('11: History heading is DayGroup with Rule B rhythm (mt-8 pb-2)', () => {
    expect(flat).toContain("t('historyHeading')");
    const idx = flat.indexOf("t('historyHeading')");
    const window = flat.slice(Math.max(0, idx - 80), idx + 40);
    expect(window).toContain('<DayGroup');
    expect(window).toContain('mt-8');
    expect(window).toContain('pb-2');
    expect(window).not.toContain('<H4>');
  });
});

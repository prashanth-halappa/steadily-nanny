/**
 * @module domains/schedule/__tests__/WeekBlocksEditor.test
 *
 * Source-inspection tests (docs/09-TESTING.md §5 Pattern A) — NOT a render
 * test. WeekBlocksEditor imports TimeRangePicker, which itself cannot be
 * parsed under bun:test. This file pins that the screen wires logic up
 * correctly.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/WeekBlocksEditor.tsx');
let source: string;

describe('WeekBlocksEditor source', () => {
  it('reads the component source', async () => {
    source = await Bun.file(componentPath).text();
    expect(source.length).toBeGreaterThan(0);
  });

  it('exports the component', () => {
    expect(source).toContain('export function WeekBlocksEditor');
  });

  it('assigns each block testID with an index to prevent collisions', () => {
    expect(source).toContain('${testIDPrefix}-time-range-${day}-${i}');
    expect(source).toContain('${testIDPrefix}-outside-hours-${day}-${i}');
    expect(source).toContain('${testIDPrefix}-child-${day}-${i}-${child.id}');
    expect(source).toContain('${testIDPrefix}-remove-slot-${day}-${i}');
    expect(source).toContain('${testIDPrefix}-add-slot-${day}');
    expect(source).toContain('${testIDPrefix}-day-off-${day}');
    expect(source).toContain('${testIDPrefix}-overlap-${day}');
  });

  it('sets MAX_SLOTS_PER_DAY to 3', () => {
    expect(source).toContain('MAX_SLOTS_PER_DAY = 3');
  });

  it('references every one of the new i18n keys', () => {
    expect(source).toContain("t('build.addSlot')");
    expect(source).toContain("t('build.removeSlot')");
    expect(source).toContain("t('build.removeSlotA11y'");
    expect(source).toContain("t('build.dayOff')");
    expect(source).toContain("t('build.slotsOverlapError')");
    expect(source).toContain("t('build.maxSlotsNote')");
  });

  it('never uses a bare Modal component', () => {
    expect(source).not.toMatch(/<Modal[\s>]/);
  });

  it('never puts a NativeWind className on an Animated.View', () => {
    expect(source).not.toMatch(/<Animated\.View[^>]*className=/);
  });
});

/**
 * @module domains/setup/__tests__/AvailabilityScreen.test
 *
 * Regression coverage for the wizard step, added while extracting
 * `AvailabilityEditor` out of it — locks in that the wizard-only concerns
 * ("Finish" gated on >= 1 selected day, returning to Home) survive the
 * refactor unchanged.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/AvailabilityScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('AvailabilityScreen (wizard)', () => {
  it('exports the screen', () => {
    expect(source).toContain('export function AvailabilityScreen');
  });

  it('reuses AvailabilityEditor for the weekday/time-range body', () => {
    expect(source).toContain('AvailabilityEditor');
  });

  it('still gates Finish on at least one selected day and returns to Home', () => {
    expect(source).toContain('selectedDays.length === 0');
    expect(source).toContain('/(private)/(tabs)/home');
  });

  it('keeps its wizard testID', () => {
    expect(source).toContain('availability-screen');
  });
});

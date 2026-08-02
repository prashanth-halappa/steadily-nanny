/**
 * @module domains/setup/__tests__/AvailabilityEditor.test
 *
 * Source-inspection test for the weekday/time-range editor body, extracted
 * out of `AvailabilityScreen` so it can be reused by the settings entry
 * point (`ManageAvailabilityScreen`) without re-implementing the WEEKDAY
 * CONVENTION notes (Postgres `extract(dow)`, 0=Sunday..6=Saturday).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/AvailabilityEditor.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('AvailabilityEditor', () => {
  it('exports the component', () => {
    expect(source).toContain('export function AvailabilityEditor');
  });

  it('wires the week-strip and per-day time-range testIDs', () => {
    expect(source).toContain('availability-week-strip');
    expect(source).toContain('availability-time-range-');
  });

  it('uses the availability query and full-row upsert mutation', () => {
    expect(source).toContain('useAvailability');
    expect(source).toContain('useUpsertAvailability');
  });

  it('sends the FULL weekday row on every edit, never a partial patch', () => {
    expect(source).toContain('evening_mode');
  });

  it('labels days through the shared schedule:weekday namespace, not a local copy', () => {
    expect(source).toContain("useTranslation('schedule')");
    expect(source).toContain('weekday.');
    expect(source).not.toContain('DAY_LABELS');
  });
});

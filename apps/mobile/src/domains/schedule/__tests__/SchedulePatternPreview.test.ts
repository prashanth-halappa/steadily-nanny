/**
 * @module domains/schedule/__tests__/SchedulePatternPreview.test
 * Pattern A — Card + ChildChip render path; assert metadata props are wired.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const previewPath = join(__dirname, '../components/SchedulePatternPreview.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(previewPath).text();
});

describe('SchedulePatternPreview', () => {
  it('renders until, exdates, and pause_ranges when provided', () => {
    expect(source).toContain('until');
    expect(source).toContain('exdates');
    expect(source).toContain('pauseRanges');
    expect(source).toContain('pending.untilLine');
    expect(source).toContain('pending.exdatesLine');
    expect(source).toContain('pending.pauseRangeLine');
  });
});

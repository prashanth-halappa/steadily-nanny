/**
 * @module domains/today/__tests__/CoverageGapBanner.test
 * Pattern B — coverage gap banner on TodayScreen (Wave D).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const bannerPath = join(__dirname, '../components/CoverageGapBanner.tsx');
const todayPath = join(__dirname, '../components/TodayScreen.tsx');
let bannerSource: string;
let todaySource: string;

beforeAll(async () => {
  bannerSource = await Bun.file(bannerPath).text();
  todaySource = await Bun.file(todayPath).text();
});

describe('CoverageGapBanner source', () => {
  it('uses useDayThread and filters coverage_gap events', () => {
    expect(bannerSource).toContain('useDayThread');
    expect(bannerSource).toContain("event_type === 'coverage_gap'");
    expect(bannerSource).toContain('testID="coverage-gap-banner"');
    expect(bannerSource).toContain('testID={`coverage-gap-item-${gap.id}`}');
    expect(bannerSource).toContain('coverageGap.title');
    expect(bannerSource).toContain('coverageGap.description');
  });

  it('is mounted on TodayScreen', () => {
    expect(todaySource).toContain('CoverageGapBanner');
  });
});

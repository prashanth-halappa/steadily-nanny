/**
 * @module domains/schedule/__tests__/SchedulePatternBanner.contrast.test
 *
 * Rule M on washPlum: the accepted (L4) arm sits over ScreenWash brand,
 * where mutedForeground fails AA. Attention arm already uses mutedStrong.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const bannerPath = join(__dirname, '../components/SchedulePatternBanner.tsx');
let bannerSource: string;
let acceptedArm: string;

beforeAll(async () => {
  bannerSource = await Bun.file(bannerPath).text();
  // Second `schedule-pattern-banner` testID is the accepted bare-View arm;
  // the first is the attention Card. Slice from the second so we never
  // confuse the two (attention was fixed in a prior wave).
  const first = bannerSource.indexOf('testID="schedule-pattern-banner"');
  const second = bannerSource.indexOf(
    'testID="schedule-pattern-banner"',
    first + 1
  );
  acceptedArm = bannerSource.slice(second);
});

describe('SchedulePatternBanner accepted arm contrast', () => {
  it('uses mutedStrong on status and closed-reason lines over the brand wash', () => {
    expect(acceptedArm).toMatch(
      /schedule-pattern-banner-status[\s\S]{0,100}text-muted-strong/
    );
    expect(acceptedArm).toMatch(
      /schedule-pattern-banner-action-reason[\s\S]{0,100}text-muted-strong/
    );
    expect(acceptedArm).not.toMatch(
      /schedule-pattern-banner-status[\s\S]{0,100}text-muted-foreground/
    );
    expect(acceptedArm).not.toMatch(
      /schedule-pattern-banner-action-reason[\s\S]{0,100}text-muted-foreground/
    );
  });
});

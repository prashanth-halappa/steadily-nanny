/**
 * @module domains/today/__tests__/TodayScreen.i18n.test
 * Pattern A — TodayScreen title and empty state (Wave 2G).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/TodayScreen.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('TodayScreen i18n', () => {
  it('localizes the screen title and empty state through today namespace', () => {
    expect(screenSource).toContain("useTranslation('today')");
    expect(screenSource).toContain("t('screenTitle')");
    expect(screenSource).toContain("t('emptyTitle')");
    expect(screenSource).toContain("t('emptyDescription')");
    expect(screenSource).not.toContain('>Today<');
    expect(screenSource).not.toContain('Your week will appear here');
    expect(screenSource).not.toContain(
      'Once you add a schedule, upcoming shifts and updates will show up on this screen.'
    );
  });

  it('REGRESSION: the no-household empty state carries a stable testID so Maestro can assert it', () => {
    expect(screenSource).toContain('testID="today-empty"');
  });

  // REGRESSION (BUG1, same as Settings/Hours/Schedule): the floating tab bar
  // overlays this screen's content instead of reserving its own layout
  // space — a fixed paddingBottom is not safe-area-aware and can strand the
  // last row in a tap-through dead zone under the bar.
  it('REGRESSION: sizes scroll bottom padding off the tab bar height, not a static magic number', () => {
    expect(screenSource).toContain('useTabBarScrollPadding');
    expect(screenSource).toContain('paddingBottom: tabBarScrollPadding');
  });

  // Wave 2-G: the orphan household-name Body folded into the H1 block, and
  // the date joins it — "Today" with no date on it read as odd.
  it('folds the date (and, when there is one household, its name) under the H1', () => {
    expect(screenSource).toContain('testID="today-date"');
    expect(screenSource).toContain('formatDisplayDate');
    expect(screenSource).not.toContain('testID="today-household-name"');
  });

  // Wave 2-G: "Parent at ease" — mounted only for the parent role, and it
  // owns its own render condition (see TodayCalmCard.test.tsx).
  it('mounts TodayCalmCard for the parent role', () => {
    expect(screenSource).toContain('<TodayCalmCard');
    expect(screenSource).toContain('canViewParentSchedule(onboarding.role)');
  });
});

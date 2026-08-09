/**
 * @module domains/today/__tests__/CoverCard.test
 * Pattern B — live cover card on Today (uncovered-care rework).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const cardPath = join(__dirname, '../components/CoverCard.tsx');
const hookPath = join(__dirname, '../hooks/useUncoveredToday.ts');
const todayPath = join(__dirname, '../components/TodayScreen.tsx');
let cardSource: string;
let hookSource: string;
let todaySource: string;

beforeAll(async () => {
  cardSource = await Bun.file(cardPath).text();
  hookSource = await Bun.file(hookPath).text();
  todaySource = await Bun.file(todayPath).text();
});

describe('CoverCard source', () => {
  it('computes live via useUncoveredToday, not day-thread events', () => {
    expect(hookSource).toContain('computeUncovered');
    expect(hookSource).not.toContain('useDayThread');
    expect(cardSource).toContain('useUncoveredToday');
    expect(cardSource).not.toContain('useTodayCoverageGaps');
  });

  it('uses testID cover-card and the cover.* copy namespace', () => {
    expect(cardSource).toContain('testID="cover-card"');
    expect(cardSource).toContain("t('cover.");
    expect(cardSource).toContain('coveredVariantIndex');
  });

  it('uses opaque Card tone="attention" when uncovered (with demoted escape hatch)', () => {
    expect(cardSource).toContain("tone={demoted ? 'default' : 'attention'}");
    expect(cardSource).not.toContain('bg-warning/15');
  });

  it('uses tone="positive" for the daily covered reassurance, never attention', () => {
    expect(cardSource).toContain('tone="positive"');
    expect(cardSource).toMatch(/status === 'covered'[\s\S]*tone="positive"/);
  });

  it('is role-gated on TodayScreen for parent and helper only', () => {
    expect(todaySource).toContain('canViewParentSchedule');
    expect(todaySource).toContain('CoverCard');
    expect(todaySource).not.toContain('CoverageGapBanner');
  });
});

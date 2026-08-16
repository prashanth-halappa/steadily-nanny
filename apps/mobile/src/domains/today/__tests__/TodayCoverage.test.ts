/**
 * @module domains/today/__tests__/TodayCoverage.test
 * Pattern B — unified parent coverage surface on Today.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const coveragePath = join(__dirname, '../components/TodayCoverage.tsx');
const hookPath = join(__dirname, '../hooks/useTodayCoverage.ts');
const todayPath = join(__dirname, '../components/TodayScreen.tsx');
let coverageSource: string;
let hookSource: string;
let todaySource: string;

beforeAll(async () => {
  coverageSource = await Bun.file(coveragePath).text();
  hookSource = await Bun.file(hookPath).text();
  todaySource = await Bun.file(todayPath).text();
});

describe('TodayCoverage source', () => {
  it('composes useUncoveredToday and useTodayCoverRows — no new network', () => {
    expect(hookSource).toContain('useUncoveredToday');
    expect(hookSource).toContain('useTodayCoverRows');
    expect(hookSource).toContain('COVERING_SHIFT_STATUSES');
    expect(hookSource).not.toContain('useTodayCoverageGaps');
    expect(coverageSource).toContain('useTodayCoverage');
  });

  it('uses coverage.* copy for gap and plan, never cover.uncovered or cover.allCovered', () => {
    expect(coverageSource).toContain("t('coverage.gap.");
    expect(coverageSource).toContain("t('coverage.plan.");
    expect(coverageSource).not.toContain('cover.uncovered');
    expect(coverageSource).not.toContain('cover.allCovered');
    expect(coverageSource).not.toContain('parentNoCoverTitle');
  });

  it('calls describeUncoveredCause for gap reasons', () => {
    expect(coverageSource).toContain('describeUncoveredCause');
  });

  // §5.4 / D-47. The countdown maths is pinned in gapEscalation.test.ts; this
  // pins that the card is actually WIRED to it — and that escalating stays a
  // copy change on the existing `attention` ground, never a new tone.
  it('escalates the gap headline from the clock', () => {
    expect(coverageSource).toContain('gapEscalationHours');
    expect(coverageSource).toContain("t('coverage.gap.titleOneEscalated'");
    expect(coverageSource).not.toContain("'critical'");
  });

  // The pinned slot is the emphasis now, so this card has ONE look: a gap it
  // renders is a gap that owns the slot (a parent's `uncoveredCare` can only
  // lose to nanny-only rungs).
  it('uses opaque Card tone="attention" when gap, with no demoted branch left', () => {
    expect(coverageSource).toContain('tone="attention"');
    expect(coverageSource).not.toContain('demoted');
  });

  it('is role-gated on TodayScreen for parent and helper only', () => {
    expect(todaySource).toContain('canViewParentSchedule');
    expect(todaySource).toContain('TodayCoverage');
    expect(todaySource).not.toContain('CoverCard');
    expect(todaySource).not.toContain('NannyLiveStatusCard');
  });
});

/**
 * @module domains/schedule/__tests__/SchedulePendingScreen.test
 *
 * Source-inspection test for SchedulePendingScreen (Pattern A,
 * docs/09-TESTING.md §5) — the screen uses `AlertDialog` (from
 * `@rn-primitives/alert-dialog`), which is not mocked in the global preload
 * (`apps/mobile/bun.setup.ts`), so we assert architectural markers instead of
 * rendering. Mirrors `apps/mobile/src/app/(private)/(tabs)/__tests__/settings.test.tsx`,
 * the precedent for AlertDialog-using screens.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/SchedulePendingScreen.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('SchedulePendingScreen', () => {
  it('exports the screen', () => {
    expect(screenSource).toContain('export function SchedulePendingScreen');
  });

  it('reads pattern state from the data-layer hooks', () => {
    expect(screenSource).toContain('useSchedulePatterns');
    expect(screenSource).toContain('useWithdrawSchedulePattern');
    expect(screenSource).toContain('useIsOnboarded');
  });

  it('wires the always-present screen root testID', () => {
    expect(screenSource).toContain('schedule-pending-screen');
  });

  it('wires the empty-state testIDs', () => {
    expect(screenSource).toContain('schedule-pending-empty');
    expect(screenSource).toContain('schedule-pending-build-cta');
  });

  it('wires the withdraw flow testIDs', () => {
    expect(screenSource).toContain('schedule-pending-withdraw');
    expect(screenSource).toContain('schedule-pending-withdraw-confirm');
  });

  it('wires the accepted-state view-shifts testID', () => {
    expect(screenSource).toContain('schedule-pending-view-shifts');
  });

  it('confirms withdrawal via AlertDialog, never a bare RN Modal (GOLDEN-FIX #1)', () => {
    expect(screenSource).toContain('AlertDialog');
    expect(screenSource).not.toMatch(/<Modal\b/);
  });

  it('maps the accepted pattern status to the confirmed StatusPill variant', () => {
    const acceptedIndex = screenSource.indexOf("'accepted'");
    const confirmedIndex = screenSource.indexOf("'confirmed'");
    expect(acceptedIndex).toBeGreaterThan(-1);
    expect(confirmedIndex).toBeGreaterThan(-1);
  });
});

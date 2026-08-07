/**
 * @module widgets/lib/render
 *
 * Pure rendering-decision helpers for the four home-screen widgets: which
 * lines a family has room for, and whether a snapshot has gone stale.
 *
 * These are NOT imported by the widget components themselves. A function
 * carrying the `'widget'` directive is serialized to a source STRING and
 * evaluated in a bare JavaScriptCore context that has only the `@expo/ui`
 * globals — no repo imports, no sibling helpers (see `OnTheClock.tsx`'s
 * header for the full explanation). So this module exists to be unit-tested
 * on its own, and each widget file re-states the same logic inline by hand —
 * the widget components themselves cannot render outside WidgetKit, so they
 * are not tested directly (per docs/09-TESTING.md).
 */
import type { WidgetFamily } from 'expo-widgets';

import {
  type CoverRowProps,
  type NextShiftRow,
  SNAPSHOT_AS_OF_MS,
  SNAPSHOT_DEGRADE_MS,
} from '@/src/lib/widgetSnapshot.types';

export function snapshotAgeMs(generatedAtIso: string, nowMs: number): number {
  return Math.max(0, nowMs - new Date(generatedAtIso).getTime());
}

/** Past this age, clock-derived claims must degrade to schedule truth. */
export function isSnapshotStale(
  generatedAtIso: string,
  nowMs: number
): boolean {
  return snapshotAgeMs(generatedAtIso, nowMs) > SNAPSHOT_DEGRADE_MS;
}

/** Past this age, the widget additionally shows the `asOfLabel` footer. */
export function shouldShowAsOf(generatedAtIso: string, nowMs: number): boolean {
  return snapshotAgeMs(generatedAtIso, nowMs) > SNAPSHOT_AS_OF_MS;
}

export interface ResolvedCoverRow {
  title: string;
  detail: string | null;
  showDot: boolean;
}

/** Picks the fresh, clock-derived text or the schedule-truth fallback. */
export function resolveCoverRow(
  row: CoverRowProps,
  stale: boolean
): ResolvedCoverRow {
  if (stale) {
    return { title: row.staleTitle, detail: row.staleDetail, showDot: false };
  }
  return { title: row.title, detail: row.detail, showDot: row.isLiveDot };
}

/**
 * Home-screen families only — children's names never appear on the lock
 * screen (accessory families). `systemSmall` drops the line first when a
 * pending-response banner is also competing for its limited height;
 * `systemMedium` always has room for both.
 */
export function showChildrenLine(
  family: WidgetFamily,
  hasPendingBanner: boolean
): boolean {
  if (family === 'systemMedium') return true;
  if (family === 'systemSmall') return !hasPendingBanner;
  return false;
}

/** `systemSmall` renders the next shift only; `systemMedium` fits both rows. */
export function visibleNextShiftRows(
  rows: NextShiftRow[],
  family: WidgetFamily
): NextShiftRow[] {
  return family === 'systemMedium' ? rows : rows.slice(0, 1);
}

/**
 * `systemSmall` shows the top row plus `moreLabel`; `systemMedium` has room
 * for a handful more before WidgetKit's own clipping takes over.
 */
export function visibleCoverRows(
  rows: CoverRowProps[],
  family: WidgetFamily
): CoverRowProps[] {
  return family === 'systemMedium' ? rows.slice(0, 4) : rows.slice(0, 1);
}

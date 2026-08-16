/**
 * @module domains/today/__tests__/TodayScreen.layout.test
 *
 * Pattern A — the one claim no render test can make. `PinnedSlot` reserves
 * layout height only while it is a SIBLING ABOVE the ScrollView in normal
 * flow. Move it inside the scroll and every behavioural test still passes
 * while the fold bug is back; give it `position: 'absolute'` and it floats
 * over the feed, which is exactly how the respond CTA's tap landed on the
 * Hours tab (y 881–929, viewport ending at 873).
 *
 * A rendered tree cannot tell you any of that — React Native's test renderer
 * runs no Yoga layout — so the file order is the check.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/TodayScreen.tsx');
const slotPath = join(__dirname, '../components/PinnedSlot.tsx');
let screenSource: string;
let slotSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
  slotSource = await Bun.file(slotPath).text();
});

describe('TodayScreen layout', () => {
  it('mounts the pinned slot BEFORE the ScrollView, so its height is reserved', () => {
    const slotAt = screenSource.indexOf('<PinnedSlot>{');
    const scrollAt = screenSource.indexOf('<ScrollView');

    expect(slotAt).toBeGreaterThan(-1);
    expect(scrollAt).toBeGreaterThan(-1);
    expect(slotAt).toBeLessThan(scrollAt);
  });

  it('keeps the header static, above the slot', () => {
    const headerAt = screenSource.indexOf('testID="today-header"');
    const slotAt = screenSource.indexOf('<PinnedSlot>{');
    const scrollAt = screenSource.indexOf('<ScrollView');

    expect(headerAt).toBeLessThan(slotAt);
    expect(headerAt).toBeLessThan(scrollAt);
  });

  it('never floats the slot over the feed', () => {
    expect(slotSource).not.toContain('absolute');
    expect(slotSource).not.toContain('onLayout');
  });

  // The mechanic is deleted, not merely unused: emphasis is `usePinnedTone`,
  // and the only way to earn it is to be the slot's single child.
  it('carries no `demoted` prop anywhere', () => {
    expect(screenSource).not.toContain('demoted');
    expect(screenSource).toContain('resolveSlotOccupant');
    expect(screenSource).toContain('<PinnedSlot>');
  });

  // P5/S10 — the cross-family strip renders BEFORE everything else: it is
  // not scoped to the active household at all, so it must not sit behind
  // (or compete with) the header, the slot, or the feed.
  it('mounts the cross-family strip before the header, before the slot, before the ScrollView', () => {
    const stripAt = screenSource.indexOf('<CrossFamilyStrip');
    const headerAt = screenSource.indexOf('testID="today-header"');
    const slotAt = screenSource.indexOf('<PinnedSlot>{');
    const scrollAt = screenSource.indexOf('<ScrollView');

    expect(stripAt).toBeGreaterThan(-1);
    expect(stripAt).toBeLessThan(headerAt);
    expect(headerAt).toBeLessThan(slotAt);
    expect(slotAt).toBeLessThan(scrollAt);
  });

  it('renders the lead line directly under the date', () => {
    const dateAt = screenSource.indexOf('testID="today-date"');
    const leadAt = screenSource.indexOf('testID="today-lead"');
    const slotAt = screenSource.indexOf('<PinnedSlot>{');

    expect(dateAt).toBeGreaterThan(-1);
    expect(leadAt).toBeGreaterThan(-1);
    expect(leadAt).toBeGreaterThan(dateAt);
    expect(leadAt).toBeLessThan(slotAt);
  });
});

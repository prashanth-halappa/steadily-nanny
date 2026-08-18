/**
 * @module domains/today/__tests__/TodayScreen.layout.test
 *
 * Pattern A — the one claim no render test can make. The whole screen
 * scrolls now, so what is pinned about `PinnedSlot` is its RANK: it must be
 * the first thing in the feed, above the household switcher, and it must
 * stay in normal flow. Give it `position: 'absolute'` and it floats over the
 * feed, which is exactly how the respond CTA's tap landed on the Hours tab
 * (y 881–929, viewport ending at 873).
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
  it('scrolls the whole screen: header and slot live INSIDE the ScrollView', () => {
    const scrollAt = screenSource.indexOf('<ScrollView');
    const headerAt = screenSource.indexOf('testID="today-header"');
    const slotAt = screenSource.indexOf('<PinnedSlot>{');

    expect(scrollAt).toBeGreaterThan(-1);
    expect(headerAt).toBeGreaterThan(scrollAt);
    expect(slotAt).toBeGreaterThan(headerAt);
  });

  // WP-C: Settings lost its tab, so Today's hero band carries the only way
  // in from this screen. It must sit in the band itself (`today-header`),
  // above the feed — not somewhere down the scroll where it can't be found.
  it('carries the settings header button inside the today-header band', () => {
    const headerAt = screenSource.indexOf('testID="today-header"');
    const trailingAt = screenSource.indexOf(
      'trailingAction={<SettingsHeaderButton'
    );
    const slotAt = screenSource.indexOf('<PinnedSlot>{');

    expect(screenSource).toContain('SettingsHeaderButton');
    expect(trailingAt).toBeGreaterThan(headerAt);
    expect(trailingAt).toBeLessThan(slotAt);
  });

  it('keeps the slot above the household switcher, the first card in the feed', () => {
    const slotAt = screenSource.indexOf('<PinnedSlot>{');
    const switcherAt = screenSource.indexOf('<HouseholdSwitcher />');

    expect(switcherAt).toBeGreaterThan(-1);
    expect(slotAt).toBeLessThan(switcherAt);
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
  it('mounts the cross-family strip before the ScrollView, so it never scrolls away', () => {
    const stripAt = screenSource.indexOf('<CrossFamilyStrip');
    const scrollAt = screenSource.indexOf('<ScrollView');
    const headerAt = screenSource.indexOf('testID="today-header"');

    expect(stripAt).toBeGreaterThan(-1);
    expect(stripAt).toBeLessThan(scrollAt);
    expect(stripAt).toBeLessThan(headerAt);
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

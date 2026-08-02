/**
 * @module app/(private)/__tests__/_layout.test
 *
 * Source-inspection test (Pattern A, docs/09-TESTING.md §5) — the private
 * layout pulls in expo-router's Stack and auth gates, so we assert global
 * banners/modals are mounted alongside OfflineBanner instead of rendering.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const layoutPath = join(__dirname, '../_layout.tsx');
let layoutSource: string;

beforeAll(async () => {
  layoutSource = await Bun.file(layoutPath).text();
});

describe('PrivateLayout mount order', () => {
  const mountOrder = [
    '<OfflineBanner />',
    '<SoftUpdateBanner />',
    '<Stack screenOptions={{ headerShown: false }}>',
    '<AnnouncementModal />',
    '<NotificationSoftAskSheet',
  ];

  it('mounts global chrome in the required order inside SafeAreaView', () => {
    let previousIndex = -1;
    for (const token of mountOrder) {
      const index = layoutSource.indexOf(token);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it('places OfflineBanner above the Stack navigator', () => {
    expect(layoutSource.indexOf('<OfflineBanner />')).toBeLessThan(
      layoutSource.indexOf('<Stack screenOptions={{ headerShown: false }}>')
    );
  });

  it('places SoftUpdateBanner above the Stack and below OfflineBanner', () => {
    expect(layoutSource.indexOf('<SoftUpdateBanner />')).toBeGreaterThan(
      layoutSource.indexOf('<OfflineBanner />')
    );
    expect(layoutSource.indexOf('<SoftUpdateBanner />')).toBeLessThan(
      layoutSource.indexOf('<Stack screenOptions={{ headerShown: false }}>')
    );
  });

  it('places AnnouncementModal after the Stack (sibling overlay, not inside navigator)', () => {
    expect(layoutSource.indexOf('<AnnouncementModal />')).toBeGreaterThan(
      layoutSource.indexOf('</Stack>')
    );
  });
});

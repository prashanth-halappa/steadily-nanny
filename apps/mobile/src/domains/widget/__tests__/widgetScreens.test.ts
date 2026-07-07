import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

// Pattern A (source inspection): these screens drag in expo-router, reanimated,
// and native modules, so we assert architectural markers rather than rendering.
let sectionSrc: string;
let detailSrc: string;
let debugSrc: string;

beforeAll(async () => {
  sectionSrc = await Bun.file(
    join(__dirname, '../components/WidgetsSection.tsx')
  ).text();
  detailSrc = await Bun.file(
    join(__dirname, '../components/WidgetDetailScreen.tsx')
  ).text();
  debugSrc = await Bun.file(
    join(__dirname, '../../../app/(private)/debug.tsx')
  ).text();
});

describe('WidgetsSection', () => {
  it('exports the section component', () => {
    expect(sectionSrc).toContain('export function WidgetsSection');
  });

  it('wires the list + gated-create flows via the hooks', () => {
    expect(sectionSrc).toContain('useWidgets');
    expect(sectionSrc).toContain('useCreateWidget');
  });

  it('exposes interactive testIDs and navigates to the detail route', () => {
    expect(sectionSrc).toContain('widget-name-input');
    expect(sectionSrc).toContain('widget-create-button');
    expect(sectionSrc).toContain('/widget/');
  });
});

describe('WidgetDetailScreen', () => {
  it('exports the detail screen', () => {
    expect(detailSrc).toContain('export function WidgetDetailScreen');
  });

  it('wires the LLM, push, and delete mutations', () => {
    expect(detailSrc).toContain('useGenerateWidgetDescription');
    expect(detailSrc).toContain('useNotifyWidget');
    expect(detailSrc).toContain('useDeleteWidget');
  });

  it('exposes the action testIDs', () => {
    expect(detailSrc).toContain('widget-generate-button');
    expect(detailSrc).toContain('widget-notify-button');
    expect(detailSrc).toContain('widget-delete-button');
  });
});

describe('Debug cockpit', () => {
  it('is dev-gated', () => {
    expect(debugSrc).toContain('if (!__DEV__)');
  });

  it('drives every verification seam (kill/force/rating/offline/quota/status)', () => {
    expect(debugSrc).toContain('debug-kill-switch');
    expect(debugSrc).toContain('debug-force-update');
    expect(debugSrc).toContain('debug-rating');
    expect(debugSrc).toContain('debug-offline-toggle');
    expect(debugSrc).toContain('debug-fetch-usage');
    expect(debugSrc).toContain('debug-app-status');
  });

  it('uses the real kit seams (appConfigStore, onlineManager, maybeRequestReview)', () => {
    expect(debugSrc).toContain('useAppConfigStore');
    expect(debugSrc).toContain('onlineManager');
    expect(debugSrc).toContain('maybeRequestReview');
    expect(debugSrc).toContain('getWidgetUsage');
  });
});

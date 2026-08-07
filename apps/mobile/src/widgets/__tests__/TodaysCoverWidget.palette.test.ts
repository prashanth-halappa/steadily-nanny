/**
 * @module widgets/__tests__/TodaysCoverWidget.palette.test
 * See `NextShiftWidget.palette.test.ts` for why this file exists.
 */
import { describe, expect, it } from 'bun:test';
import { liveCardBackground } from '@/lib/design-tokens/elevation';
import { palette } from '@/lib/design-tokens/palette';
import {
  SNAPSHOT_AS_OF_MS,
  SNAPSHOT_DEGRADE_MS,
} from '@/src/lib/widgetSnapshot.types';

const source = await Bun.file(
  new URL('../TodaysCoverWidget.tsx', import.meta.url)
).text();

describe('TodaysCoverWidget inlined palette', () => {
  it('FG follows palette.{light,dark}.foreground', () => {
    expect(source).toContain(
      `const FG = dark ? '${palette.dark.foreground.hex}' : '${palette.light.foreground.hex}';`
    );
  });

  it('MUTED follows palette.{light,dark}.mutedForeground', () => {
    expect(source).toContain(
      `const MUTED = dark ? '${palette.dark.mutedForeground.hex}' : '${palette.light.mutedForeground.hex}';`
    );
  });

  it('OCHRE follows palette.{light,dark}.warning', () => {
    expect(source).toContain(
      `const OCHRE = dark ? '${palette.dark.warning.hex}' : '${palette.light.warning.hex}';`
    );
  });

  it('APRICOT follows palette.{light,dark}.highlight', () => {
    expect(source).toContain(
      `const APRICOT = dark ? '${palette.dark.highlight.hex}' : '${palette.light.highlight.hex}';`
    );
  });

  it('CARD follows palette.{light,dark}.card', () => {
    expect(source).toContain(
      `const CARD = dark ? '${palette.dark.card.hex}' : '${palette.light.card.hex}';`
    );
  });

  it('PLUM follows palette.{light,dark}.primary', () => {
    expect(source).toContain(
      `const PLUM = dark ? '${palette.dark.primary.hex}' : '${palette.light.primary.hex}';`
    );
  });

  // The live ground is the whole point of the redesign for this widget: warm
  // card = someone is with the kids right now. It must be the SAME fill
  // `NannyLiveStatusCard` uses in-app, so it is pinned to the function that
  // computes it rather than to a hand-copied hex.
  it('CARD_LIVE follows liveCardBackground()', () => {
    expect(source).toContain(
      `const CARD_LIVE = dark ? '${liveCardBackground('dark')}' : '${liveCardBackground('light')}';`
    );
  });

  // The staleness thresholds are inlined FIGURES for the same reason the
  // hexes are (`widgetScope.test.ts` enforces the "no names" half). These two
  // keep the figures equal to the shared constants they duplicate — the
  // widget degrading on a different schedule than the snapshot was built for
  // is the silent version of the ReferenceError this once threw.
  it('inlines SNAPSHOT_DEGRADE_MS as the row-staleness figure', () => {
    expect(source).toContain(
      `const stale = ageMs > ${SNAPSHOT_DEGRADE_MS / 60_000} * 60 * 1000;`
    );
  });

  it('inlines SNAPSHOT_AS_OF_MS as the footer figure', () => {
    expect(source).toContain(
      `const showAsOf = ageMs > ${SNAPSHOT_AS_OF_MS / 3_600_000} * 60 * 60 * 1000;`
    );
  });

  it('pulls in nothing the widget extension cannot resolve', () => {
    const valueImports = [
      ...source.matchAll(/^import (?!type )[\s\S]*?from '([^']+)';/gm),
    ].map(match => match[1]);

    expect(valueImports.sort()).toEqual([
      '@/src/lib/expoWidgets',
      '@/src/lib/widgetSnapshot',
      '@expo/ui/swift-ui',
      '@expo/ui/swift-ui/modifiers',
    ]);
  });
});

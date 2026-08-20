/**
 * @module widgets/__tests__/ParentWeekWidget.palette.test
 * See `NextShiftWidget.palette.test.ts` for why this file exists.
 */
import { describe, expect, it } from 'bun:test';
import { palette } from '@/lib/design-tokens/palette';

const source = await Bun.file(
  new URL('../ParentWeekWidget.tsx', import.meta.url)
).text();

describe('ParentWeekWidget inlined palette', () => {
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

  // `figure` token is 28 — hero must not use the oversized 34/32 branches.
  // Whitespace-insensitive: Biome re-wraps long modifier lists.
  it('hero figure uses figure-token size 28', () => {
    const flat = source.replace(/\s+/g, ' ');
    expect(flat).toContain(
      "font({ size: 28, weight: 'bold', design: 'rounded', })"
    );
    expect(flat).not.toContain('isMedium ? 34 : 32');
  });
});

/**
 * @module widgets/__tests__/NannyWeekWidget.palette.test
 * See `NextShiftWidget.palette.test.ts` for why this file exists.
 */
import { describe, expect, it } from 'bun:test';
import { palette } from '@/lib/design-tokens/palette';

const source = await Bun.file(
  new URL('../NannyWeekWidget.tsx', import.meta.url)
).text();

describe('NannyWeekWidget inlined palette', () => {
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

  it('GREEN follows palette.{light,dark}.success', () => {
    expect(source).toContain(
      `const GREEN = dark ? '${palette.dark.success.hex}' : '${palette.light.success.hex}';`
    );
  });

  it('TERRACOTTA follows palette.{light,dark}.shortNotice', () => {
    expect(source).toContain(
      `const TERRACOTTA = dark ? '${palette.dark.shortNotice.hex}' : '${palette.light.shortNotice.hex}';`
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

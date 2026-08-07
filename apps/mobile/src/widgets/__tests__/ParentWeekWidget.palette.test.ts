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

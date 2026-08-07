/**
 * @module widgets/__tests__/NextShiftWidget.palette.test
 *
 * `NextShiftWidgetView` carries the `'widget'` directive (see
 * `OnTheClock.tsx`'s header), so its colours are inlined literals rather
 * than reads from `palette.ts`. This pins the duplicate honest: retune a
 * token and the widget silently keeps the old colour until this fails.
 * Source-text assertions, not rendering — the component cannot render
 * outside WidgetKit.
 */
import { describe, expect, it } from 'bun:test';
import { palette } from '@/lib/design-tokens/palette';

const source = await Bun.file(
  new URL('../NextShiftWidget.tsx', import.meta.url)
).text();

describe('NextShiftWidget inlined palette', () => {
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

  it('OCHRE follows palette.{light,dark}.warning', () => {
    expect(source).toContain(
      `const OCHRE = dark ? '${palette.dark.warning.hex}' : '${palette.light.warning.hex}';`
    );
  });

  it('OCHRE_FG (text-on-ochre) follows palette.dark.background / palette.light.foreground', () => {
    expect(source).toContain(
      `const OCHRE_FG = dark ? '${palette.dark.background.hex}' : '${palette.light.foreground.hex}';`
    );
  });

  it('pulls in nothing the widget extension cannot resolve', () => {
    // Same allowlist as OnTheClock.palette.test.ts, plus the one repo import
    // this file needs OUTSIDE the 'widget'-tagged function: registering the
    // widget with `widgetSnapshot` at module scope (see widgetSnapshot.ts's
    // module header — registration is deliberately inverted so that module
    // never imports @expo/ui).
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

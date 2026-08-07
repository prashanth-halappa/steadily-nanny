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

  // `@expo/ui` hex strings are #RRGGBBAA — alpha LAST, not #AARRGGBB.
  // `expo-modules-core`'s Convertibles+Color.swift pads a 6-digit string with
  // `FF` and reads `red = rgba >> 24`; alpha-first exists only for numeric
  // colors. The alpha-FIRST version shipped: `'#33' + '#C08A3E'.slice(1)` is
  // `#33C08A3E`, which is mint green at 24%, not ochre at 20%. Pinned as a
  // literal so a "tidy-up" cannot silently swap the halves back.
  it('tints the status pill with alpha LAST (#RRGGBBAA)', () => {
    expect(source).toContain('const pillBg = `${statusFg}29`;');
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

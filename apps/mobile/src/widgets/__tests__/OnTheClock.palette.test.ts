/**
 * @module widgets/__tests__/OnTheClock.palette.test
 *
 * `OnTheClockView` carries the `'widget'` directive, which means babel
 * replaces it with a STRING of its own source that a bare JavaScriptCore
 * context inside the widget extension evaluates. Nothing it imports exists
 * out there, so its colours are inlined literals rather than reads from
 * `palette.dark` — the one place in this app where duplicating a token is
 * correct.
 *
 * This is the check that keeps the duplicate honest: rename or retune a dark
 * token and the lock screen silently keeps the old colour, with no compile
 * error and no runtime error, until someone notices the Live Activity does
 * not match the app. Source-text assertions rather than rendering, because
 * the component cannot be rendered outside WidgetKit.
 */
import { describe, expect, it } from 'bun:test';
import { palette } from '@/lib/design-tokens/palette';

const source = await Bun.file(
  new URL('../OnTheClock.tsx', import.meta.url)
).text();

/** Local const name in `OnTheClockView` → the `palette.dark` key it copies. */
const INLINED_COLOURS = {
  BG: 'background',
  FG: 'foreground',
  MUTED: 'mutedForeground',
  APRICOT: 'highlight',
  OCHRE: 'warning',
  GREEN: 'success',
} as const;

describe('OnTheClock inlined palette', () => {
  for (const [local, token] of Object.entries(INLINED_COLOURS)) {
    it(`${local} still equals palette.dark.${token}`, () => {
      const hex = palette.dark[token].hex;
      expect(source).toContain(`const ${local} = '${hex}';`);
    });
  }

  it('pulls in nothing the widget extension cannot resolve', () => {
    // The only identifiers the serialized function can reach are the
    // `@expo/ui` views and modifiers installed as globals in the extension's
    // JS context. A repo import here would typecheck, pass lint, and then be
    // `undefined` at render — so the value-import list is pinned.
    const valueImports = [
      ...source.matchAll(/^import (?!type )[\s\S]*?from '([^']+)';/gm),
    ].map(match => match[1]);

    expect(valueImports.sort()).toEqual([
      '@/src/lib/expoWidgets',
      '@expo/ui/swift-ui',
      '@expo/ui/swift-ui/modifiers',
    ]);
  });
});

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PALETTE_CSS_VARS, type PaletteKey, palette } from '../palette';

/**
 * GUARDRAIL: palette.ts and global.css stay in lockstep.
 * HSL↔hex is lossy — only the hslToHex check allows ±2/255 per channel.
 */

/** Keys intentionally absent from CSS (none today — borderStrong + scrim promoted). */
const TS_ONLY_ALLOWLIST: ReadonlySet<PaletteKey> = new Set();

function parseCssVarBlock(css: string, selector: string): Map<string, string> {
  const re = new RegExp(
    `${selector.replace('.', '\\.')}\\s*\\{([^}]+)\\}`,
    'm'
  );
  const match = css.match(re);
  if (!match?.[1]) {
    throw new Error(`Could not find ${selector} block in global.css`);
  }
  const map = new Map<string, string>();
  for (const line of match[1].split('\n')) {
    const m = line.match(/--([a-z0-9-]+)\s*:\s*([^;]+);/);
    if (!m?.[1] || !m[2]) continue;
    // Strip trailing comments
    const value = m[2].replace(/\/\*.*\*\//, '').trim();
    map.set(m[1], value);
  }
  return map;
}

/** Convert "H S% L%" channel triple → [r,g,b] 0–255. */
function hslChannelsToRgb(css: string): [number, number, number] {
  const parts = css.trim().split(/\s+/);
  if (parts.length !== 3) {
    throw new Error(`Expected H S% L% triple, got: ${css}`);
  }
  const h = Number(parts[0]);
  const s = Number(parts[1]?.replace('%', ''));
  const l = Number(parts[2]?.replace('%', ''));
  if ([h, s, l].some(n => Number.isNaN(n))) {
    throw new Error(`Non-numeric HSL channels: ${css}`);
  }
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
  };
  return [f(0), f(8), f(4)];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length !== 6) throw new Error(`Expected 6-digit hex, got: ${hex}`);
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

const globalCssPath = join(import.meta.dir, '../../../global.css');
const globalCss = readFileSync(globalCssPath, 'utf8');

describe('palette ↔ global.css parity', () => {
  for (const mode of ['light', 'dark'] as const) {
    const selector = mode === 'light' ? ':root' : '.dark:root';
    const cssVars = parseCssVarBlock(globalCss, selector);
    const modePalette = palette[mode];

    describe(mode, () => {
      it('every palette entry matches its CSS var exactly (css string)', () => {
        const mismatches: string[] = [];
        for (const key of Object.keys(PALETTE_CSS_VARS) as PaletteKey[]) {
          if (TS_ONLY_ALLOWLIST.has(key)) continue;
          const varName = PALETTE_CSS_VARS[key];
          const expected = modePalette[key].css;
          const actual = cssVars.get(varName);
          if (actual !== expected) {
            mismatches.push(
              `--${varName}: palette="${expected}" css="${actual ?? '(missing)'}"`
            );
          }
        }
        expect(mismatches).toEqual([]);
      });

      it('palette and CSS vars are bijective (no orphans either direction)', () => {
        const paletteVarNames = new Set<string>(
          (Object.keys(PALETTE_CSS_VARS) as PaletteKey[])
            .filter(k => !TS_ONLY_ALLOWLIST.has(k))
            .map(k => PALETTE_CSS_VARS[k])
        );
        const cssNames = new Set(cssVars.keys());

        const missingInCss = [...paletteVarNames].filter(n => !cssNames.has(n));
        const orphansInCss = [...cssNames].filter(n => !paletteVarNames.has(n));

        expect({ missingInCss, orphansInCss }).toEqual({
          missingInCss: [],
          orphansInCss: [],
        });
      });

      it('hslToHex(css) is within ±2/255 of entry.hex', () => {
        const mismatches: string[] = [];
        for (const key of Object.keys(PALETTE_CSS_VARS) as PaletteKey[]) {
          const entry = modePalette[key];
          const fromCss = hslChannelsToRgb(entry.css);
          const fromHex = hexToRgb(entry.hex);
          const ok = fromCss.every(
            (channel, i) => Math.abs(channel - (fromHex[i] ?? 0)) <= 2
          );
          if (!ok) {
            mismatches.push(
              `${key}: css→[${fromCss}] hex→[${fromHex}] (${entry.hex})`
            );
          }
        }
        expect(mismatches).toEqual([]);
      });

      it('TS_ONLY_ALLOWLIST entries are not silently growing', () => {
        // Documented empty: borderStrong and scrim are real CSS vars.
        expect([...TS_ONLY_ALLOWLIST]).toEqual([]);
      });
    });
  }
});

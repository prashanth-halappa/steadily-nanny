/**
 * Daylight elevation — RN inline `boxShadow` styles.
 *
 * NativeWind's box-shadow parser (react-native-css-interop 0.2.6) is broken:
 * it maps to shadowColor/shadowRadius, reads radius from spread, bails on
 * multi-layer, and falls through into aspect-ratio. Tailwind `shadow-*`
 * utilities are deliberately `none`; use this hook instead.
 *
 * Never put these styles on an `Animated.View` that also carries `className`
 * (GOLDEN-FIXES #2 / animatedViewClassName CI guard).
 *
 * Shadowed surfaces need opaque backgrounds (GOLDEN-FIXES #19) — do not
 * combine elevation with translucent tints like `bg-card/90`.
 */

import type { ViewStyle } from 'react-native';
import { useColorScheme } from '@/lib/useColorScheme';
import { palette } from './palette';

type PaletteMode = 'light' | 'dark';

/**
 * Convert `#RRGGBB` to `rgba(r, g, b, alpha)`.
 * Local helper — `colors.ts`'s keyed opacity map doesn't cover 0.12 / 0.42.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveMode(modeOrIsDark: PaletteMode | boolean): PaletteMode {
  if (typeof modeOrIsDark === 'boolean') {
    return modeOrIsDark ? 'dark' : 'light';
  }
  return modeOrIsDark;
}

/**
 * Apricot wash gradient stops for the Today live wash (Wave C).
 * `highlight` at 0.16→0 (light) / 0.13→0 (dark); locations match the 62% stop.
 */
export function washGradient(modeOrIsDark: PaletteMode | boolean): {
  colors: [string, string];
  locations: [number, number];
} {
  const mode = resolveMode(modeOrIsDark);
  const apricot = palette[mode].highlight.hex;
  const fromAlpha = mode === 'dark' ? 0.13 : 0.16;
  return {
    colors: [hexToRgba(apricot, fromAlpha), hexToRgba(apricot, 0)],
    locations: [0, 0.62],
  };
}

/**
 * Mix `overlay` onto `base` at `amount` (0–1) and return an opaque `#RRGGBB`.
 * Used for the live card ground (~8% apricot on card) — never a translucent
 * class like `bg-card/90` (GOLDEN-FIXES #19).
 */
export function mixHex(base: string, overlay: string, amount: number): string {
  const parse = (hex: string) => {
    const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
    return [
      Number.parseInt(cleaned.slice(0, 2), 16),
      Number.parseInt(cleaned.slice(2, 4), 16),
      Number.parseInt(cleaned.slice(4, 6), 16),
    ] as const;
  };
  const [br, bg, bb] = parse(base);
  const [or, og, ob] = parse(overlay);
  const t = Math.min(1, Math.max(0, amount));
  const channel = (b: number, o: number) =>
    Math.round(b * (1 - t) + o * t)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(br, or)}${channel(bg, og)}${channel(bb, ob)}`.toUpperCase();
}

/** Opaque live-card fill — highlight mixed onto card at 8%. */
export function liveCardBackground(mode: PaletteMode): string {
  return mixHex(palette[mode].card.hex, palette[mode].highlight.hex, 0.08);
}

/** Exported for token tests — the app should use `useElevation()`. */
export function elevationForMode(mode: PaletteMode): {
  card: ViewStyle;
  liveCard: ViewStyle;
  liveCardBackground: string;
  row: ViewStyle;
} {
  const ink = palette[mode].foreground.hex;
  const apricot = palette[mode].highlight.hex;

  return {
    card: {
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 1,
          blurRadius: 2,
          spreadDistance: 0,
          color: hexToRgba(ink, 0.05),
        },
        {
          offsetX: 0,
          offsetY: 10,
          blurRadius: 24,
          spreadDistance: -12,
          color: hexToRgba(ink, 0.2),
        },
      ],
    },
    liveCard: {
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 1,
          blurRadius: 2,
          spreadDistance: 0,
          color: hexToRgba(apricot, 0.12),
        },
        {
          offsetX: 0,
          offsetY: 14,
          blurRadius: 30,
          spreadDistance: -12,
          color: hexToRgba(apricot, 0.42),
        },
      ],
    },
    liveCardBackground: liveCardBackground(mode),
    row: {
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 1,
          blurRadius: 2,
          spreadDistance: 0,
          color: 'rgba(0, 0, 0, 0.05)',
        },
      ],
    },
  };
}

// Built once at module load, like `useThemeColors`'s lightColors/darkColors.
// Rebuilding per render would hand every consumer a new style-object identity
// each time, defeating React.memo on anything downstream of <Card>.
const LIGHT_ELEVATION = elevationForMode('light');
const DARK_ELEVATION = elevationForMode('dark');

/**
 * Mode-aware elevation styles for cards / live cards / rows.
 * Derive colours from the palette so shadows stay in sync with Daylight.
 */
export function useElevation(): {
  card: ViewStyle;
  liveCard: ViewStyle;
  liveCardBackground: string;
  row: ViewStyle;
} {
  const { isDarkColorScheme } = useColorScheme();
  return isDarkColorScheme ? DARK_ELEVATION : LIGHT_ELEVATION;
}

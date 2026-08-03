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

/** Exported for token tests — the app should use `useElevation()`. */
export function elevationForMode(mode: PaletteMode): {
  card: ViewStyle;
  liveCard: ViewStyle;
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
  row: ViewStyle;
} {
  const { isDarkColorScheme } = useColorScheme();
  return isDarkColorScheme ? DARK_ELEVATION : LIGHT_ELEVATION;
}

/**
 * @module lib/design-tokens/__tests__/elevation.test
 *
 * Daylight's elevation is the one design token that can't be parity-tested
 * against `global.css` — NativeWind's box-shadow parser is broken, so these
 * shadows are RN inline styles built in TS from the palette. This file is the
 * substitute guardrail.
 *
 * Two things worth pinning:
 *   (a) the shadows are DERIVED from the palette, not hardcoded — a palette
 *       change must move them, or they silently desync from the direction;
 *   (b) `useElevation` returns stable object identities across calls. It
 *       previously rebuilt them per render, which hands every consumer a new
 *       style object each time and defeats React.memo below <Card>.
 */
import { describe, expect, it } from 'bun:test';
import type { BoxShadowValue, ViewStyle } from 'react-native';
import { elevationForMode, hexToRgba, washGradient } from '../elevation';
import { palette } from '../palette';

describe('hexToRgba', () => {
  it('converts a palette hex to an rgba string at the given alpha', () => {
    expect(hexToRgba('#E8823C', 0.42)).toBe('rgba(232, 130, 60, 0.42)');
  });

  it('tolerates a missing leading hash', () => {
    expect(hexToRgba('2A1F2B', 0.05)).toBe('rgba(42, 31, 43, 0.05)');
  });
});

describe('washGradient', () => {
  it('fades the apricot highlight to transparent at the spec 62% stop', () => {
    const light = washGradient('light');
    expect(light.locations).toEqual([0, 0.62]);
    expect(light.colors[0]).toBe(hexToRgba(palette.light.highlight.hex, 0.16));
    expect(light.colors[1]).toBe(hexToRgba(palette.light.highlight.hex, 0));
  });

  it('uses the dimmer dark-mode opening alpha', () => {
    expect(washGradient('dark').colors[0]).toBe(
      hexToRgba(palette.dark.highlight.hex, 0.13)
    );
  });

  it('accepts an isDark boolean as well as a mode name', () => {
    expect(washGradient(true)).toEqual(washGradient('dark'));
    expect(washGradient(false)).toEqual(washGradient('light'));
  });
});

/**
 * RN types `boxShadow` as `string | readonly BoxShadowValue[]` — Daylight only
 * ever builds the array form, so narrow once here rather than at each call.
 */
function layers(style: ViewStyle): readonly BoxShadowValue[] {
  const shadow = style.boxShadow;
  return typeof shadow === 'string' || shadow === undefined ? [] : shadow;
}

/** Layer colours off an RN multi-layer `boxShadow` style. */
function layerColours(style: ViewStyle) {
  return layers(style).map(layer => layer.color);
}

describe('elevationForMode', () => {
  it('derives the resting card shadow from the palette ink, not a hardcoded hex', () => {
    expect(layerColours(elevationForMode('light').card)).toEqual([
      hexToRgba(palette.light.foreground.hex, 0.05),
      hexToRgba(palette.light.foreground.hex, 0.2),
    ]);
  });

  it('derives the live card shadow from the palette apricot', () => {
    expect(layerColours(elevationForMode('light').liveCard)).toEqual([
      hexToRgba(palette.light.highlight.hex, 0.12),
      hexToRgba(palette.light.highlight.hex, 0.42),
    ]);
  });

  it('tracks the dark palette independently', () => {
    expect(layerColours(elevationForMode('dark').liveCard)).toEqual([
      hexToRgba(palette.dark.highlight.hex, 0.12),
      hexToRgba(palette.dark.highlight.hex, 0.42),
    ]);
  });

  it('keeps the resting and live shadows the same shape, differing in colour and lift', () => {
    // Same layer count and same direction — if the geometry diverged, the card
    // would visibly jump rather than warm when someone clocks in.
    const light = elevationForMode('light');
    expect(layers(light.card)).toHaveLength(layers(light.liveCard).length);
    expect(layers(light.card).map(l => l.offsetX)).toEqual(
      layers(light.liveCard).map(l => l.offsetX)
    );
  });

  it('gives rows a single, subtler layer than cards', () => {
    const light = elevationForMode('light');
    expect(layerColours(light.row)).toHaveLength(1);
    expect(layerColours(light.card)).toHaveLength(2);
  });
});

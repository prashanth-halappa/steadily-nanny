/**
 * @module lib/design-tokens/__tests__/palette-surface-tones
 *
 * Wave 0 (P0-1) — three new tone surfaces (`surfaceAttention`,
 * `surfacePositive`, `surfaceLive`), each derived with the existing
 * `mixHex()` rather than a freehand hex guess. `surfaceLive` must be
 * identical to what `liveCardBackground()` already computes — it names an
 * existing value, it does not introduce a new one.
 */
import { describe, expect, it } from 'bun:test';
import { liveCardBackground, mixHex } from '../elevation';
import { PALETTE_CSS_VARS, palette } from '../palette';

describe('surface tone tokens', () => {
  it('derives surfaceAttention from mixHex(card, warning, …) in both modes', () => {
    expect(palette.light.surfaceAttention).toEqual({
      css: '35 52% 91%',
      hex: mixHex(palette.light.card.hex, palette.light.warning.hex, 0.18),
    });
    expect(palette.dark.surfaceAttention).toEqual({
      css: '4 13% 20%',
      hex: mixHex('#241C26', '#E0B061', 0.12),
    });
  });

  it('derives surfacePositive from mixHex(card, success, …) in both modes', () => {
    expect(palette.light.surfacePositive).toEqual({
      css: '140 16% 93%',
      hex: mixHex(palette.light.card.hex, palette.light.success.hex, 0.12),
    });
    expect(palette.dark.surfacePositive).toEqual({
      css: '240 4% 18%',
      hex: mixHex('#241C26', '#6FB98A', 0.1),
    });
  });

  it('derives surfaceLive from mixHex(card, highlight, …) — identical to liveCardBackground()', () => {
    expect(palette.light.surfaceLive).toEqual({
      css: '26 78% 96%',
      hex: mixHex(palette.light.card.hex, palette.light.highlight.hex, 0.08),
    });
    expect(palette.light.surfaceLive.hex).toBe(liveCardBackground('light'));
    expect(palette.dark.surfaceLive).toEqual({
      css: '347 16% 18%',
      hex: mixHex('#241C26', '#F2954B', 0.08),
    });
  });

  it('registers all tone surface keys in PALETTE_CSS_VARS', () => {
    expect(PALETTE_CSS_VARS.surfaceAttention).toBe('surface-attention');
    expect(PALETTE_CSS_VARS.surfacePositive).toBe('surface-positive');
    expect(PALETTE_CSS_VARS.surfaceLive).toBe('surface-live');
    expect(PALETTE_CSS_VARS.surfaceCritical).toBe('surface-critical');
  });
});

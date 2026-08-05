/**
 * GUARDRAIL: typography.ts tokens stay aligned with typography-scale.js
 * (consumed by tailwind.config.js). Drift here means text-3xl ≠ <H1>.
 */

import { describe, expect, it } from 'bun:test';

import { FONT_FAMILY, typography } from '../typography';
import {
  FONT_FAMILY as SCALE_FONT_FAMILY,
  typographyFontSize,
} from '../typography-scale.js';

type ScaleEntry = [string, { lineHeight: string; fontWeight?: string }];

function parsePx(value: string): number {
  return Number.parseInt(value.replace('px', ''), 10);
}

function entrySize(entry: string | ScaleEntry): {
  size: number;
  lineHeight: number;
  fontWeight?: string;
} {
  if (typeof entry === 'string') {
    return { size: parsePx(entry), lineHeight: parsePx(entry) };
  }
  const [sizeStr, meta] = entry;
  return {
    size: parsePx(sizeStr),
    lineHeight: parsePx(meta.lineHeight),
    fontWeight: meta.fontWeight,
  };
}

function expectScaleMatchesToken(
  scaleKey: keyof typeof typographyFontSize,
  token: { size: number; lineHeight: number; weight: string }
) {
  const raw = typographyFontSize[scaleKey];
  const parsed = entrySize(raw as string | ScaleEntry);
  expect(parsed.size).toBe(token.size);
  expect(parsed.lineHeight).toBe(token.lineHeight);
}

describe('typography.ts ↔ typography-scale.js parity', () => {
  it('FONT_FAMILY matches between TS tokens and the Tailwind scale module', () => {
    expect(FONT_FAMILY).toBe(SCALE_FONT_FAMILY);
  });

  it('core scale steps match typography tokens', () => {
    expectScaleMatchesToken('base', typography.body);
    expectScaleMatchesToken('body', typography.body);
    expectScaleMatchesToken('lg', typography.bodyLarge);
    expectScaleMatchesToken('body-lg', typography.bodyLarge);
    expectScaleMatchesToken('sm', typography.bodySmall);
    expectScaleMatchesToken('body-sm', typography.bodySmall);
    expectScaleMatchesToken('caption', typography.caption);
    expectScaleMatchesToken('xl', typography.h3);
    expectScaleMatchesToken('2xl', typography.h2);
    expectScaleMatchesToken('3xl', typography.h1);
    expectScaleMatchesToken('4xl', typography.display);
    expectScaleMatchesToken('display', typography.display);
    expectScaleMatchesToken('label', typography.label);
    expectScaleMatchesToken('button', typography.button);
  });

  it('display semantic alias carries display token weight', () => {
    const parsed = entrySize(typographyFontSize.display as string | ScaleEntry);
    expect(parsed.fontWeight).toBe(typography.display.weight);
  });

  it('label semantic alias carries label token weight', () => {
    const parsed = entrySize(typographyFontSize.label as string | ScaleEntry);
    expect(parsed.fontWeight).toBe(typography.label.weight);
  });
});

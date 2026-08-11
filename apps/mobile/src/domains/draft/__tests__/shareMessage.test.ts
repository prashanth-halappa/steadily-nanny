/**
 * @module domains/draft/__tests__/shareMessage
 *
 * §6.1's "what leaves the phone". Tested here rather than through the sheet
 * because the test harness's `t()` echoes keys without interpolating, so the
 * assembled sentence is only observable against a real interpolator.
 */
import { describe, expect, it } from 'bun:test';
import enDraft from '@/src/i18n/locales/en/draft.json';
import { buildShareMessage, termsPageUrl } from '../utils/shareMessage';

/** Interpolates like i18next does, against the REAL en copy. */
const t = (key: string, params?: Record<string, unknown>) => {
  const template = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      enDraft
    );
  return String(template ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) =>
    String(params?.[name] ?? '')
  );
};

describe('termsPageUrl', () => {
  it('points at the public terms page for that code', () => {
    expect(termsPageUrl('R4K-92T')).toBe(
      'https://nanny.getsteadily.app/t/R4K-92T'
    );
  });
});

describe('buildShareMessage', () => {
  it('sends the link and her name', () => {
    const message = buildShareMessage(t, { name: 'Marisol', code: 'R4K-92T' });

    expect(message).toContain('https://nanny.getsteadily.app/t/R4K-92T');
    expect(message).toContain('Marisol');
  });

  it('never sends a bare code with no link around it', () => {
    const message = buildShareMessage(t, { name: 'Marisol', code: 'R4K-92T' });

    // The code appears exactly once, and only as the tail of the URL.
    expect(message.split('R4K-92T')).toHaveLength(2);
    expect(message).not.toMatch(/\bcode\b/i);
  });

  it('carries no figure — a lock screen is a public surface', () => {
    const message = buildShareMessage(t, { name: 'Marisol', code: 'R4K-92T' });

    expect(message).not.toMatch(/\d+\.\d{2}/);
  });
});

/**
 * @module domains/schedule/utils/__tests__/relativeDaysAgo
 */
import { afterEach, describe, expect, it } from 'bun:test';
import i18n from '@/src/i18n';
import { relativeDaysAgo } from '../relativeDaysAgo';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'schedule', ...params });

describe('relativeDaysAgo', () => {
  it('reads "Sent today" the same calendar day it was sent', () => {
    expect(relativeDaysAgo('2026-08-10T09:00:00.000Z', '2026-08-10', t)).toBe(
      'Sent today'
    );
  });

  it('pluralises singular vs plural day counts', () => {
    expect(relativeDaysAgo('2026-08-09T09:00:00.000Z', '2026-08-10', t)).toBe(
      'Sent 1 day ago'
    );
    expect(relativeDaysAgo('2026-08-05T09:00:00.000Z', '2026-08-10', t)).toBe(
      'Sent 5 days ago'
    );
  });

  it('clamps a future sentAt (clock skew) to "Sent today" instead of a negative count', () => {
    expect(relativeDaysAgo('2026-08-12T09:00:00.000Z', '2026-08-10', t)).toBe(
      'Sent today'
    );
  });

  it('resolves distinct Spanish singular/plural copy', async () => {
    await i18n.changeLanguage('es');
    expect(relativeDaysAgo('2026-08-09T09:00:00.000Z', '2026-08-10', t)).toBe(
      'Enviado hace 1 día'
    );
    expect(relativeDaysAgo('2026-08-05T09:00:00.000Z', '2026-08-10', t)).toBe(
      'Enviado hace 5 días'
    );
  });
});

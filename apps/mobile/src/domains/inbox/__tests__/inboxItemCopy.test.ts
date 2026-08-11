/**
 * @module domains/inbox/__tests__/inboxItemCopy.test
 *
 * The words and the destination for the inbox kinds this slice adds or
 * changes (`docs/design/attention-and-notifications.md` §2.3). `t` echoes its
 * key under the test i18n instance, so the sentences themselves are asserted
 * against the locale JSON — the only place they actually exist.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { InboxItem } from '../utils/buildInboxItems';
import {
  ctaForItem,
  hrefForItem,
  subtitleForItem,
  titleForItem,
} from '../utils/inboxItemCopy';

const t = (key: string) => key;
const ZONE = 'Europe/London';

const staleItem: InboxItem = {
  kind: 'stale_submitted_week',
  id: 'ts-stale',
  weekStart: '2026-08-04',
  daysAgo: 21,
  totalMinutes: 2310,
};

async function locale(language: 'en' | 'es') {
  return Bun.file(
    join(__dirname, `../../../i18n/locales/${language}/inbox.json`)
  ).json();
}

describe('stale_submitted_week copy', () => {
  it('states how long and stops — no countdown, no "overdue", no colour', () => {
    expect(titleForItem(staleItem, t)).toBe('items.staleSubmittedWeek.title');
    expect(subtitleForItem(staleItem, t, ZONE)).toBe(
      'items.staleSubmittedWeek.subtitle'
    );
    expect(ctaForItem(staleItem, t)).toBe('items.staleSubmittedWeek.cta');
  });

  it('opens the week it is about', () => {
    expect(hrefForItem(staleItem)).toBe(
      '/(private)/(tabs)/hours?weekStart=2026-08-04'
    );
  });

  it('says how long and how many hours, in both languages', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = (await locale(language)).items.staleSubmittedWeek;
      expect(copy.title).toContain('{{week}}');
      expect(copy.title).toContain('{{days}}');
      expect(copy.subtitle).toContain('{{hours}}');
      expect(copy.cta.length).toBeGreaterThan(0);
      // A fact about a date, never a verdict about a family.
      expect(copy.title.toLowerCase()).not.toContain('overdue');
      expect(copy.title.toLowerCase()).not.toContain('late');
    }
  });
});

// §2.3(d): the reply is now the thing that moves a queried week, so the verb
// on the card says so.
describe('queried_week cta', () => {
  it('reads "Read and reply", not a generic review verb', async () => {
    expect((await locale('en')).items.queriedWeek.cta).toBe('Read and reply');
    expect((await locale('es')).items.queriedWeek.cta).not.toBe(
      'Read and reply'
    );
    expect((await locale('es')).items.queriedWeek.cta.length).toBeGreaterThan(
      0
    );
  });
});

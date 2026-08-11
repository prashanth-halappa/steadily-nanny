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
  deadlineForItem,
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

// §2.2/§2.3a — cover-ask-awaiting-you and extra-shift-proposed share this kind.
describe('pending_shift copy', () => {
  const NOW = Date.parse('2026-08-25T12:00:00.000Z');

  function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
    return {
      kind: 'pending_shift',
      id: 'shift-1',
      localDate: '2026-08-26',
      startsAt: '2026-08-26T08:00:00.000Z',
      endsAt: '2026-08-26T13:00:00.000Z',
      createdAt: '2026-08-24T00:00:00.000Z',
      coverAskExpiresAt: '2026-08-27T18:00:00.000Z',
      ...overrides,
    } as InboxItem;
  }

  it('opens the shift it is about', () => {
    expect(hrefForItem(makeItem())).toBe('/(private)/schedule/shifts/shift-1');
  });

  it('has title/subtitle/cta keys', () => {
    expect(titleForItem(makeItem(), t, ZONE)).toBe('items.pendingShift.title');
    expect(subtitleForItem(makeItem(), t, ZONE)).toBe(
      'items.pendingShift.subtitle'
    );
    expect(ctaForItem(makeItem(), t)).toBe('items.pendingShift.cta');
  });

  it('falls back to a subtitle without the expiry when there is none stamped', () => {
    expect(
      subtitleForItem(makeItem({ coverAskExpiresAt: null }), t, ZONE)
    ).toBe('items.pendingShift.subtitleNoDeadline');
  });

  // M21: `deadlineForItem` is reserved for Rule B's one coloured-text
  // exception, and this is what it was reserved for — but only inside the
  // urgent window (§5.3/M21, `COVER_ASK_URGENT_HOURS`).
  it('deadlineForItem is null well outside the urgent window', () => {
    expect(deadlineForItem(makeItem(), t, ZONE, NOW)).toBeNull();
  });

  it('deadlineForItem returns the deadline string inside the urgent window', () => {
    const item = makeItem({ coverAskExpiresAt: '2026-08-25T20:00:00.000Z' });
    expect(deadlineForItem(item, t, ZONE, NOW)).toBe(
      'items.pendingShift.deadline'
    );
  });

  it('deadlineForItem is null once the ask has expired — that state is "Expired", not a deadline', () => {
    const item = makeItem({ coverAskExpiresAt: '2026-08-25T10:00:00.000Z' });
    expect(deadlineForItem(item, t, ZONE, NOW)).toBeNull();
  });

  it('deadlineForItem is null for every other kind', () => {
    expect(deadlineForItem(staleItem, t, ZONE, NOW)).toBeNull();
  });

  it('has both-language strings, no default export gaps', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = (await locale(language)).items.pendingShift;
      expect(copy.title).toContain('{{');
      expect(copy.subtitle).toContain('{{');
      expect(copy.subtitleNoDeadline.length).toBeGreaterThan(0);
      expect(copy.deadline).toContain('{{');
      expect(copy.cta.length).toBeGreaterThan(0);
    }
  });
});

describe('terms_proposal copy (§7.2, §10)', () => {
  const NOW = Date.parse('2026-08-25T12:00:00.000Z');

  function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
    return {
      kind: 'terms_proposal',
      id: 'prop-1',
      householdId: 'hh-1',
      carerDisplayName: 'Marisol',
      proposedAt: '2026-08-24T09:00:00.000Z',
      direction: 'carer',
      rateMinor: 2800,
      weeklyEquivalentMinor: 154000,
      currency: 'USD',
      ...overrides,
    } as InboxItem;
  }

  it('opens the review screen for the proposal it is about', () => {
    expect(hrefForItem(makeItem())).toBe('/(private)/pay/proposal/prop-1');
  });

  it('names who proposed, and counters name the other side instead', () => {
    expect(titleForItem(makeItem(), t, ZONE)).toBe('items.termsProposal.title');
    expect(titleForItem(makeItem({ direction: 'parent' }), t, ZONE)).toBe(
      'items.termsProposal.titleCountered'
    );
    expect(ctaForItem(makeItem(), t)).toBe('items.termsProposal.cta');
  });

  it('puts the figures in the subtitle, and drops to the rate alone with no weekly equivalent', () => {
    expect(subtitleForItem(makeItem(), t, ZONE)).toBe(
      'items.termsProposal.subtitle'
    );
    expect(
      subtitleForItem(makeItem({ weeklyEquivalentMinor: null }), t, ZONE)
    ).toBe('items.termsProposal.subtitleRateOnly');
  });

  // The proposal carries the pay-arrangement REQUEST, whose currency is
  // optional (the server resolves it from the household). No currency, no
  // figure — never a bare number or an invented symbol on a contract.
  it('says nothing about money when the proposal carries no currency', () => {
    expect(subtitleForItem(makeItem({ currency: null }), t, ZONE)).toBe(
      'items.termsProposal.subtitleNoFigures'
    );
  });

  // §7.5: proposals deliberately never expire — two people negotiating is not
  // a workflow to time out, so there is no deadline line to colour.
  it('has no deadline — a proposal never expires', () => {
    expect(deadlineForItem(makeItem(), t, ZONE, NOW)).toBeNull();
  });

  it('uses §10 state words with a date, and keeps every figure out of the title', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = (await locale(language)).items.termsProposal;
      expect(copy.title).toContain('{{carer}}');
      expect(copy.title).toContain('{{date}}');
      expect(copy.titleCountered).toContain('{{date}}');
      expect(copy.subtitle).toContain('{{rate}}');
      expect(copy.subtitle).toContain('{{weekly}}');
      expect(copy.subtitleRateOnly).toContain('{{rate}}');
      expect(copy.subtitleNoFigures.length).toBeGreaterThan(0);
      expect(copy.cta.length).toBeGreaterThan(0);
      // No figure in the title, matching the push discipline (§13).
      for (const key of ['title', 'titleCountered'] as const) {
        expect(copy[key]).not.toContain('{{rate}}');
        expect(copy[key]).not.toContain('{{weekly}}');
      }
      // §10: never a verdict about a person, and "Agreed" is this flow's
      // word — an inbox row about an open proposal claims neither.
      for (const key of ['title', 'titleCountered', 'subtitle', 'cta']) {
        const text = copy[key].toLowerCase();
        expect(text).not.toContain('approv');
        expect(text).not.toContain('aprob');
        expect(text).not.toContain('pending approval');
        expect(text).not.toContain('!');
      }
    }
  });
});

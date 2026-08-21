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
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types';
import { formatDuration } from '@/src/domains/timesheet/utils/duration';
import { NOTIFICATION_ROUTE_MAP } from '@/src/lib/notificationRouteMap';
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
  householdId: 'hh-1',
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

  it('opens the week it is about, carrying its household', () => {
    expect(hrefForItem(staleItem)).toBe(
      '/(private)/(tabs)/hours?weekStart=2026-08-04&householdId=hh-1'
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

describe('change_request href', () => {
  it('opens shift detail via shiftDetailHref, carrying the change request id — byte-identical to the push destination', () => {
    const item: InboxItem = {
      kind: 'change_request',
      id: 'cr-1',
      shiftId: 'shift-1',
      requestKind: 'time_change',
      requestedAt: '2026-08-24T09:00:00.000Z',
      requesterName: 'Marisol',
      shiftStartsAt: null,
    };
    expect(hrefForItem(item)).toBe(
      '/(private)/schedule/shifts/shift-1?changeRequestId=cr-1'
    );
  });
});

// WP-H — the row names who asked and when, not just what kind of change.
describe('change_request copy names the requester and the date (WP-H)', () => {
  function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
    return {
      kind: 'change_request',
      id: 'cr-1',
      shiftId: 'shift-1',
      requestKind: 'time_change',
      requestedAt: '2026-08-24T09:00:00.000Z',
      requesterName: 'Marisol',
      shiftStartsAt: null,
      ...overrides,
    } as InboxItem;
  }

  it('titles counter_offer, time_change, and cancel by the requester name', () => {
    expect(
      titleForItem(makeItem({ requestKind: 'counter_offer' }), t, ZONE)
    ).toBe('items.changeRequest.titleCounterOffer');
    expect(
      titleForItem(makeItem({ requestKind: 'time_change' }), t, ZONE)
    ).toBe('items.changeRequest.titleTimeChange');
    expect(titleForItem(makeItem({ requestKind: 'cancel' }), t, ZONE)).toBe(
      'items.changeRequest.titleCancel'
    );
  });

  it('falls back to the generic kind-worded title for split/handover', () => {
    expect(titleForItem(makeItem({ requestKind: 'split' }), t, ZONE)).toBe(
      'items.changeRequest.title'
    );
    expect(titleForItem(makeItem({ requestKind: 'handover' }), t, ZONE)).toBe(
      'items.changeRequest.title'
    );
  });

  it('falls back to the generic title when the requester is unresolved', () => {
    expect(titleForItem(makeItem({ requesterName: null }), t, ZONE)).toBe(
      'items.changeRequest.title'
    );
  });

  it('subtitle names the date it was asked', () => {
    expect(subtitleForItem(makeItem(), t, ZONE)).toBe(
      'items.changeRequest.subtitleAsked'
    );
  });

  it('has a {{name}} placeholder in both languages, per kind', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = (await locale(language)).items.changeRequest;
      expect(copy.titleCounterOffer).toContain('{{name}}');
      expect(copy.titleTimeChange).toContain('{{name}}');
      expect(copy.titleCancel).toContain('{{name}}');
      expect(copy.subtitleAsked).toContain('{{askedDate}}');
    }
  });
});

describe('hours-tab hrefs carry householdId (HYBRID contract)', () => {
  it('queried_week', () => {
    const item: InboxItem = {
      kind: 'queried_week',
      id: 'ts-2',
      householdId: 'hh-9',
      weekStart: '2026-07-28',
      queryNote: null,
      householdName: null,
    };
    expect(hrefForItem(item)).toBe(
      '/(private)/(tabs)/hours?weekStart=2026-07-28&householdId=hh-9'
    );
  });

  it('submitted_week', () => {
    const item: InboxItem = {
      kind: 'submitted_week',
      id: 'ts-3',
      householdId: 'hh-9',
      weekStart: '2026-07-28',
      carerDisplayName: 'Test Nanny',
      totalMinutes: 2310,
    };
    expect(hrefForItem(item)).toBe(
      '/(private)/(tabs)/hours?weekStart=2026-07-28&householdId=hh-9'
    );
  });
});

// Approval-queue copy must carry hours and a year — "Week of 4 Jan" on
// 21 Aug is ambiguous; a blank hours line invites a rubber-stamp.
describe('submitted_week copy', () => {
  function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
    return {
      kind: 'submitted_week',
      id: 'ts-sub',
      householdId: 'hh-1',
      weekStart: '2026-01-04',
      carerDisplayName: 'Jamie Carer',
      totalMinutes: 2310,
      ...overrides,
    } as InboxItem;
  }

  it('title week param includes the year (formatDisplayDateWithYear)', () => {
    let week: string | undefined;
    titleForItem(makeItem(), (key, opts) => {
      week = opts?.week;
      return key;
    });
    expect(week).toContain('2026');
  });

  it('subtitle passes formatDuration(totalMinutes) as hours', () => {
    let hours: string | undefined;
    subtitleForItem(
      makeItem(),
      (key, opts) => {
        hours = opts?.hours;
        return key;
      },
      ZONE
    );
    expect(hours).toBe(formatDuration(2310));
  });

  it('subtitleFallback also carries hours when no carer name', () => {
    let hours: string | undefined;
    let keyUsed = '';
    subtitleForItem(
      makeItem({ carerDisplayName: null }),
      (key, opts) => {
        keyUsed = key;
        hours = opts?.hours;
        return key;
      },
      ZONE
    );
    expect(keyUsed).toBe('items.submittedWeek.subtitleFallback');
    expect(hours).toBe(formatDuration(2310));
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
      householdId: 'hh-1',
      localDate: '2026-08-26',
      startsAt: '2026-08-26T08:00:00.000Z',
      endsAt: '2026-08-26T13:00:00.000Z',
      createdAt: '2026-08-24T00:00:00.000Z',
      coverAskExpiresAt: '2026-08-27T18:00:00.000Z',
      ...overrides,
    } as InboxItem;
  }

  it('opens the shift it is about, carrying its household — same shiftDetailHref the push notification uses', () => {
    expect(hrefForItem(makeItem())).toBe(
      '/(private)/schedule/shifts/shift-1?householdId=hh-1'
    );
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

  // An expired cover ask must not still read as "Answer by <past time>" —
  // that presents a deadline six hours gone as work she still owes.
  it('uses subtitleExpired when coverAskExpiresAt is before now', () => {
    const item = makeItem({ coverAskExpiresAt: '2026-08-25T06:00:00.000Z' });
    expect(subtitleForItem(item, t, ZONE, NOW)).toBe(
      'items.pendingShift.subtitleExpired'
    );
  });

  it('keeps subtitle when the deadline is still ahead of now', () => {
    expect(subtitleForItem(makeItem(), t, ZONE, NOW)).toBe(
      'items.pendingShift.subtitle'
    );
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

// S4b — advisory, nightly-persisted cross-household clash, nanny-only.
describe('cross_family_clash copy', () => {
  const item: InboxItem = {
    kind: 'cross_family_clash',
    id: 'shift-clash-1',
    shiftId: 'shift-clash-1',
    householdId: 'hh-1',
    startsAt: '2026-08-26T08:00:00.000Z',
  };

  it('opens the shift it is about — same shiftDetailHref every shift item uses', () => {
    expect(hrefForItem(item)).toBe(
      '/(private)/schedule/shifts/shift-clash-1?householdId=hh-1'
    );
  });

  it('has title/subtitle/cta keys', () => {
    expect(titleForItem(item, t, ZONE)).toBe('items.crossFamilyClash.title');
    expect(subtitleForItem(item, t, ZONE)).toBe(
      'items.crossFamilyClash.subtitle'
    );
    expect(ctaForItem(item, t)).toBe('items.crossFamilyClash.cta');
  });

  // Advisory only — nothing about it decays and nothing is owed by a
  // deadline (§4). Never Rule B's coloured-text exception.
  it('deadlineForItem is always null', () => {
    expect(deadlineForItem(item, t, ZONE)).toBeNull();
  });

  it('has both-language strings and a kinds label', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = await locale(language);
      expect(copy.items.crossFamilyClash.title.length).toBeGreaterThan(0);
      expect(copy.items.crossFamilyClash.subtitle).toContain('{{');
      expect(copy.items.crossFamilyClash.cta.length).toBeGreaterThan(0);
      expect(copy.kinds.cross_family_clash.length).toBeGreaterThan(0);
    }
  });
});

// A7 — the author's own row. Its whole job is to be honest about a state
// word: `viewed_at` is stamped AUTOMATICALLY on open, so the row must never
// say "opened" without "not answered" attached (§1's rule).
describe('terms_proposal_sent copy (A7)', () => {
  const NOW = Date.parse('2026-08-25T12:00:00.000Z');

  function makeItem(overrides: Record<string, unknown> = {}): InboxItem {
    return {
      kind: 'terms_proposal_sent',
      id: 'prop-9',
      householdId: 'hh-1',
      carerId: 'carer-9',
      carerDisplayName: 'Marisol',
      proposedAt: '2026-08-24T09:00:00.000Z',
      viewedAt: null,
      direction: 'parent',
      ...overrides,
    } as InboxItem;
  }

  it('opens the same review screen, in view mode', () => {
    expect(hrefForItem(makeItem())).toBe('/(private)/pay/proposal/prop-9');
  });

  it('names the carer it was sent to, and the verb is "see", not "review"', () => {
    expect(titleForItem(makeItem(), t, ZONE)).toBe(
      'items.termsProposalSent.title'
    );
    expect(ctaForItem(makeItem(), t)).toBe('items.termsProposalSent.cta');
  });

  it('forks the subtitle on opened, which is the whole point of the row', () => {
    expect(subtitleForItem(makeItem(), t, ZONE)).toBe(
      'items.termsProposalSent.subtitleNotOpened'
    );
    expect(
      subtitleForItem(
        makeItem({ viewedAt: '2026-08-24T18:00:00.000Z' }),
        t,
        ZONE
      )
    ).toBe('items.termsProposalSent.subtitleOpened');
  });

  it('has no deadline — a proposal never expires (§7.5)', () => {
    expect(deadlineForItem(makeItem(), t, ZONE, NOW)).toBeNull();
  });

  it('never lets "opened" stand alone, in either language', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = (await locale(language)).items.termsProposalSent;
      expect(copy.title).toContain('{{carer}}');
      expect(copy.subtitleOpened).toContain('{{date}}');
      expect(copy.subtitleNotOpened).toContain('{{date}}');
      expect(copy.cta.length).toBeGreaterThan(0);
      // "Opened" without "not answered" is the exact misread §1 exists to
      // kill: seen is not agreed, in either direction.
      const opened = copy.subtitleOpened.toLowerCase();
      expect(
        opened.includes('not answered') || opened.includes('sin responder')
      ).toBe(true);
      for (const key of ['title', 'subtitleOpened', 'subtitleNotOpened']) {
        const text = copy[key].toLowerCase();
        expect(text).not.toContain('agreed');
        expect(text).not.toContain('acordad');
        expect(text).not.toContain('approv');
      }
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

  // Phase 2: when the nanny must answer (family-authored), the subtitle
  // keeps the figures and names what agreeing unblocks. Parent-facing
  // (carer-authored) must not get the clock-in framing.
  it('adds the clock-in consequence when the nanny must answer (direction parent)', () => {
    expect(subtitleForItem(makeItem({ direction: 'parent' }), t, ZONE)).toBe(
      'items.termsProposal.subtitleClockIn'
    );
    expect(
      subtitleForItem(
        makeItem({ direction: 'parent', weeklyEquivalentMinor: null }),
        t,
        ZONE
      )
    ).toBe('items.termsProposal.subtitleRateOnlyClockIn');
    expect(
      subtitleForItem(
        makeItem({ direction: 'parent', currency: null }),
        t,
        ZONE
      )
    ).toBe('items.termsProposal.subtitleNoFiguresClockIn');
  });

  it('does not add the clock-in consequence when the parent must answer', () => {
    expect(subtitleForItem(makeItem({ direction: 'carer' }), t, ZONE)).toBe(
      'items.termsProposal.subtitle'
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

  it('clock-in subtitle keys keep the figures and name agreeing as the unblock', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = (await locale(language)).items.termsProposal;
      expect(copy.subtitleClockIn).toContain('{{rate}}');
      expect(copy.subtitleClockIn).toContain('{{weekly}}');
      expect(copy.subtitleRateOnlyClockIn).toContain('{{rate}}');
      expect(copy.subtitleNoFiguresClockIn.length).toBeGreaterThan(0);
      for (const key of [
        'subtitleClockIn',
        'subtitleRateOnlyClockIn',
        'subtitleNoFiguresClockIn',
      ] as const) {
        const text = copy[key].toLowerCase();
        expect(text).not.toContain('!');
        const mentionsClockIn =
          text.includes('clock in') || text.includes('fichar');
        expect(mentionsClockIn).toBe(true);
      }
    }
  });
});

describe('terms_ack copy (§2.2 rank 9)', () => {
  function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
    return {
      kind: 'terms_ack',
      id: 'arr-1',
      householdId: 'hh-1',
      validFrom: '2026-08-01',
      isFirstTerms: true,
      direction: null,
      ...overrides,
    } as InboxItem;
  }

  it('opens My pay', () => {
    expect(hrefForItem(makeItem())).toBe('/(private)/settings/my-pay');
  });

  it('uses first vs changed title keys for parent-direction and legacy', () => {
    expect(titleForItem(makeItem(), t, ZONE)).toBe('items.termsAck.titleFirst');
    expect(titleForItem(makeItem({ isFirstTerms: false }), t, ZONE)).toBe(
      'items.termsAck.titleChanged'
    );
    expect(titleForItem(makeItem({ direction: 'parent' }), t, ZONE)).toBe(
      'items.termsAck.titleFirst'
    );
    expect(
      titleForItem(
        makeItem({ direction: 'parent', isFirstTerms: false }),
        t,
        ZONE
      )
    ).toBe('items.termsAck.titleChanged');
  });

  it('uses a carer-direction title when she proposed and the family accepted', () => {
    expect(titleForItem(makeItem({ direction: 'carer' }), t, ZONE)).toBe(
      'items.termsAck.titleCarer'
    );
  });

  it('has direction-aware subtitle keys and a neutral legacy fallback', () => {
    expect(subtitleForItem(makeItem(), t, ZONE)).toBe(
      'items.termsAck.subtitle'
    );
    expect(subtitleForItem(makeItem({ direction: 'parent' }), t, ZONE)).toBe(
      'items.termsAck.subtitleParent'
    );
    expect(subtitleForItem(makeItem({ direction: 'carer' }), t, ZONE)).toBe(
      'items.termsAck.subtitleCarer'
    );
    expect(ctaForItem(makeItem(), t)).toBe('items.termsAck.cta');
  });

  it('has no deadline', () => {
    expect(deadlineForItem(makeItem(), t, ZONE)).toBeNull();
  });

  it('has both-language strings', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = (await locale(language)).items.termsAck;
      expect(copy.titleChanged).toContain('{{date}}');
      expect(copy.titleFirst.length).toBeGreaterThan(0);
      expect(copy.titleCarer.length).toBeGreaterThan(0);
      expect(copy.subtitle.length).toBeGreaterThan(0);
      expect(copy.subtitleParent.length).toBeGreaterThan(0);
      expect(copy.subtitleCarer.length).toBeGreaterThan(0);
      expect(copy.cta.length).toBeGreaterThan(0);
    }
  });

  // Phase 2: seeing is an acknowledgement, not a bookkeeping task we ask
  // her to perform — and the row must stay key-for-key across locales.
  it('drops the record-that-you-have-seen framing and keeps en/es key parity', async () => {
    const en = (await locale('en')).items.termsAck;
    const es = (await locale('es')).items.termsAck;
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());

    const bannedEn = [
      /record that you'?ve seen/i,
      /record that you have seen/i,
    ];
    const bannedEs = [/registrar que las has visto/i];
    for (const value of Object.values(en) as string[]) {
      for (const banned of bannedEn) {
        expect(value).not.toMatch(banned);
      }
      expect(value).not.toContain('!');
    }
    for (const value of Object.values(es) as string[]) {
      for (const banned of bannedEs) {
        expect(value).not.toMatch(banned);
      }
      expect(value).not.toContain('!');
    }

    expect(en.titleCarer.toLowerCase()).toMatch(/family|agreed|your terms/);
    expect(en.subtitleCarer.toLowerCase()).toMatch(/my pay/);
    expect(en.subtitleParent.toLowerCase()).toMatch(/my pay|review/);
    expect(en.subtitle.toLowerCase()).toMatch(/my pay/);
  });
});

describe('reimbursement_owed copy (§2.2 rank 8)', () => {
  const item: InboxItem = {
    kind: 'reimbursement_owed',
    id: 'hh-1:carer-1:2026-08-17',
    householdId: 'hh-1',
    weekStart: '2026-08-17',
    amountMinor: 3480,
    currency: 'GBP',
  };

  it('deep-links to the Hours week it is about, carrying its household', () => {
    expect(hrefForItem(item)).toBe(
      '/(private)/(tabs)/hours?weekStart=2026-08-17&householdId=hh-1'
    );
  });

  it('has title/subtitle/cta keys', () => {
    expect(titleForItem(item, t, ZONE)).toBe('items.reimbursementOwed.title');
    expect(subtitleForItem(item, t, ZONE)).toBe(
      'items.reimbursementOwed.subtitle'
    );
    expect(ctaForItem(item, t)).toBe('items.reimbursementOwed.cta');
  });

  it('has no deadline', () => {
    expect(deadlineForItem(item, t, ZONE)).toBeNull();
  });

  it('uses Approved in the subtitle and still owed in the title, in both languages', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = (await locale(language)).items.reimbursementOwed;
      expect(copy.title).toContain('{{amount}}');
      expect(copy.subtitle).toContain('{{week}}');
      const subtitle = copy.subtitle.toLowerCase();
      expect(subtitle.includes('approv') || subtitle.includes('aprob')).toBe(
        true
      );
      expect(copy.cta.length).toBeGreaterThan(0);
    }
  });
});

// D66 — the record of a refusal, for the person who proposed. It states the
// fact and points at the only way forward (a new round); it never grades
// either side for the answer they gave.
describe('terms_proposal_declined copy (D66)', () => {
  const NOW = Date.parse('2026-08-27T12:00:00.000Z');

  function makeItem(overrides: Record<string, unknown> = {}): InboxItem {
    return {
      kind: 'terms_proposal_declined',
      id: 'prop-7',
      householdId: 'hh-1',
      carerId: 'carer-7',
      carerDisplayName: 'Marisol',
      proposedAt: '2026-08-24T09:00:00.000Z',
      declinedAt: '2026-08-26T15:00:00.000Z',
      direction: 'parent',
      ...overrides,
    } as InboxItem;
  }

  it('opens the same review screen, in view mode', () => {
    expect(hrefForItem(makeItem())).toBe('/(private)/pay/proposal/prop-7');
  });

  it('names the carer who refused a parent-authored round', () => {
    expect(titleForItem(makeItem(), t, ZONE)).toBe(
      'items.termsProposalDeclined.title'
    );
    expect(subtitleForItem(makeItem(), t, ZONE)).toBe(
      'items.termsProposalDeclined.subtitle'
    );
    expect(ctaForItem(makeItem(), t)).toBe('items.termsProposalDeclined.cta');
  });

  // Her own name on a row about the family's answer would name the wrong
  // actor — the same trap `titleCountered` avoids on the live kind.
  it('names the family, not the carer, when the carer wrote the round', () => {
    expect(titleForItem(makeItem({ direction: 'carer' }), t, ZONE)).toBe(
      'items.termsProposalDeclined.titleFamily'
    );
  });

  it('has no deadline — there is nothing counting down', () => {
    expect(deadlineForItem(makeItem(), t, ZONE, NOW)).toBeNull();
  });

  it('states the fact and points at the next round, in both languages', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = (await locale(language)).items.termsProposalDeclined;
      expect(copy.title).toContain('{{carer}}');
      expect(copy.title).toContain('{{date}}');
      expect(copy.titleFamily).toContain('{{date}}');
      expect(copy.titleFamily).not.toContain('{{carer}}');
      expect(copy.subtitle).toContain('{{sentDate}}');
      expect(copy.cta.length).toBeGreaterThan(0);
      // §10: the state word never stands without its date, and the row never
      // grades the reader for having been refused.
      for (const key of ['title', 'titleFamily', 'subtitle']) {
        const text = copy[key].toLowerCase();
        expect(text).not.toContain('!');
        expect(text).not.toContain('rejected');
        expect(text).not.toContain('unfortunately');
        expect(text).not.toContain('sorry');
      }
    }
  });
});

// D77 — the parent's row for a carer's booked absence. Its destination is
// the ONE property that must not drift: the push and the row are the same
// fact, so they land on the same screen.
describe('carer_time_off copy (D77)', () => {
  function makeItem(overrides: Record<string, unknown> = {}): InboxItem {
    return {
      kind: 'carer_time_off',
      id: 'to-1',
      householdId: 'hh-1',
      carerDisplayName: 'Marisol',
      startsAt: '2026-08-27T09:00:00.000Z',
      endsAt: '2026-08-29T17:00:00.000Z',
      timeOffKind: 'personal',
      ...overrides,
    } as InboxItem;
  }

  it('lands on the same screen the TIME_OFF_REQUESTED push does, byte for byte', () => {
    const pushHref = NOTIFICATION_ROUTE_MAP[
      PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED
    ]({});
    expect(hrefForItem(makeItem())).toBe(
      '/(private)/settings/household-time-off'
    );
    // The resolver's return is `Href | null`; compare as strings so the
    // assertion is about the destination, not the union.
    expect(String(pushHref)).toBe(String(hrefForItem(makeItem())));
  });

  it('picks the sick fork for a sick absence', () => {
    expect(titleForItem(makeItem(), t, ZONE)).toBe('items.carerTimeOff.title');
    expect(titleForItem(makeItem({ timeOffKind: 'sick' }), t, ZONE)).toBe(
      'items.carerTimeOff.titleSick'
    );
    expect(subtitleForItem(makeItem(), t, ZONE)).toBe(
      'items.carerTimeOff.subtitle'
    );
    expect(ctaForItem(makeItem(), t)).toBe('items.carerTimeOff.cta');
  });

  it('renders a range across days and a single date within one day', async () => {
    const copy = (await locale('en')).items.carerTimeOff;
    const render = (item: InboxItem) =>
      copy.title.replace(
        '{{dates}}',
        // The interpolated value, pulled back out of the same call the
        // screen makes.
        titleForItem(item, (key, opts) => opts?.dates ?? key, ZONE)
      );
    expect(render(makeItem())).toContain('27 Aug – 29 Aug');
    expect(
      render(makeItem({ endsAt: '2026-08-27T17:00:00.000Z' }))
    ).not.toContain('–');
    expect(render(makeItem({ endsAt: '2026-08-27T17:00:00.000Z' }))).toContain(
      '27 Aug'
    );
  });

  it('names her when the roster could, and falls back to a label when it could not', () => {
    const nameOf = (item: InboxItem) =>
      titleForItem(item, (key, opts) => opts?.name ?? key, ZONE);
    expect(nameOf(makeItem())).toBe('Marisol');
    expect(nameOf(makeItem({ carerDisplayName: null }))).toBe(
      'items.carerTimeOff.carerFallback'
    );
  });

  // Nothing about an absence decays overnight, and nothing is owed by a
  // deadline — never Rule B's coloured-text exception.
  it('deadlineForItem is always null', () => {
    expect(deadlineForItem(makeItem(), t, ZONE)).toBeNull();
  });

  it('has both-language strings and a kinds label', async () => {
    for (const language of ['en', 'es'] as const) {
      const copy = await locale(language);
      expect(copy.items.carerTimeOff.title).toContain('{{name}}');
      expect(copy.items.carerTimeOff.title).toContain('{{dates}}');
      expect(copy.items.carerTimeOff.titleSick).toContain('{{name}}');
      expect(copy.items.carerTimeOff.titleSick).toContain('{{dates}}');
      expect(copy.items.carerTimeOff.subtitle.length).toBeGreaterThan(0);
      expect(copy.items.carerTimeOff.carerFallback.length).toBeGreaterThan(0);
      expect(copy.items.carerTimeOff.cta.length).toBeGreaterThan(0);
      expect(copy.kinds.carer_time_off.length).toBeGreaterThan(0);
    }
  });
});

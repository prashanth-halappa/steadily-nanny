/**
 * @module domains/inbox/__tests__/pendingOfferEscalation.test
 *
 * A7's two axes, and the rule that keeps them apart.
 *
 * CONSEQUENCE makes it loud. ELAPSED DAYS only change the words. A stale
 * offer for a nanny with NO shift scheduled must never go attention-toned,
 * however old it gets — a card that shouts about a contract nobody is
 * waiting on today is the false alarm that teaches a parent to ignore the
 * one that matters. Every "does age escalate the tone" case below is there
 * to keep that rule from quietly eroding.
 *
 * Days are counted in the HOUSEHOLD's zone, not UTC: a proposal sent at
 * 23:30 in Auckland is one calendar day old to the family that sent it, not
 * two, and "sent 10 days ago" appearing a day early is the kind of small lie
 * that costs trust on a screen about money.
 */
import { describe, expect, it } from 'bun:test';
import { resolvePendingOfferState } from '../utils/pendingOfferEscalation';

const ZONE = 'UTC';
/** 2026-08-15T12:00Z — every case measures backwards from here. */
const NOW = Date.parse('2026-08-15T12:00:00.000Z');
const DAY = 86_400_000;

function state(opts: {
  daysAgo: number;
  viewedAt?: string | null;
  hasShiftToday?: boolean;
  timeZone?: string;
  nowMs?: number;
}) {
  return resolvePendingOfferState({
    proposedAt: new Date(
      (opts.nowMs ?? NOW) - opts.daysAgo * DAY
    ).toISOString(),
    viewedAt: opts.viewedAt ?? null,
    hasShiftToday: opts.hasShiftToday ?? false,
    nowMs: opts.nowMs ?? NOW,
    timeZone: opts.timeZone ?? ZONE,
  });
}

describe('resolvePendingOfferState — the day counter', () => {
  it('day 0, not opened: sent today, and it says so', () => {
    expect(state({ daysAgo: 0 })).toEqual({
      variant: 'sentToday',
      opened: false,
      days: 0,
    });
  });

  it('day 0, already opened: still sentToday — the copy is about the send', () => {
    expect(
      state({ daysAgo: 0, viewedAt: '2026-08-15T11:00:00.000Z' })
    ).toMatchObject({ variant: 'sentToday', opened: true, days: 0 });
  });

  it('day 3, opened: waiting on her to answer', () => {
    expect(state({ daysAgo: 3, viewedAt: '2026-08-13T09:00:00.000Z' })).toEqual(
      { variant: 'waiting', opened: true, days: 3 }
    );
  });

  // The distinction the whole "Opened / Answered" vocabulary exists for: it
  // separates "ignoring me" from "thinking about it".
  it('day 3, not opened: still waiting, but reported as unopened', () => {
    expect(state({ daysAgo: 3 })).toEqual({
      variant: 'waiting',
      opened: false,
      days: 3,
    });
  });

  it('day 9 is the last day of waiting; day 10 turns stale', () => {
    expect(state({ daysAgo: 9 }).variant).toBe('waiting');
    expect(state({ daysAgo: 10 }).variant).toBe('stale');
    expect(state({ daysAgo: 40 }).variant).toBe('stale');
  });
});

describe('resolvePendingOfferState — consequence is the only loud axis', () => {
  it('a shift today makes it blocking, even on the day it was sent', () => {
    expect(state({ daysAgo: 0, hasShiftToday: true })).toEqual({
      variant: 'blocking',
      opened: false,
      days: 0,
    });
  });

  it('a shift today makes it blocking at any age', () => {
    for (const daysAgo of [1, 3, 9, 10, 60]) {
      expect(state({ daysAgo, hasShiftToday: true }).variant).toBe('blocking');
    }
  });

  // THE RULE. Age changes copy, never tone — only `blocking` may be
  // attention-toned, and age alone can never produce it.
  it('never turns blocking on age alone, however stale it gets', () => {
    for (const daysAgo of [0, 3, 10, 90, 365]) {
      expect(state({ daysAgo }).variant).not.toBe('blocking');
    }
  });

  it('keeps the day count on a blocking offer — the copy still names the date', () => {
    expect(state({ daysAgo: 12, hasShiftToday: true }).days).toBe(12);
  });
});

describe('resolvePendingOfferState — days are the household’s, not UTC’s', () => {
  // 2026-08-15T11:30Z is 2026-08-15 23:30 in Auckland, and 2026-08-15T12:30Z
  // is the 16th there. Counted in UTC both land on the same date; counted in
  // the household's zone the offer is a day old, which is what its family
  // would say out loud.
  it('counts the calendar day boundary the family actually lives in', () => {
    const nowMs = Date.parse('2026-08-16T00:30:00.000Z');
    const proposedAt = '2026-08-15T11:30:00.000Z';

    const auckland = resolvePendingOfferState({
      proposedAt,
      viewedAt: null,
      hasShiftToday: false,
      nowMs,
      timeZone: 'Pacific/Auckland',
    });
    const utc = resolvePendingOfferState({
      proposedAt,
      viewedAt: null,
      hasShiftToday: false,
      nowMs,
      timeZone: 'UTC',
    });

    // Auckland: sent on the 15th local, now the 16th local -> 1 day.
    expect(auckland.days).toBe(1);
    // UTC: sent on the 15th, now the 16th -> also 1. Same here; the case
    // below is where they diverge.
    expect(utc.days).toBe(1);
  });

  it('does not roll the counter early for a zone behind UTC', () => {
    // 2026-08-16T02:00Z is still the 15th in New York (22:00 on the 15th).
    const nowMs = Date.parse('2026-08-16T02:00:00.000Z');
    const proposedAt = '2026-08-15T14:00:00.000Z'; // 10:00 on the 15th, NY

    expect(
      resolvePendingOfferState({
        proposedAt,
        viewedAt: null,
        hasShiftToday: false,
        nowMs,
        timeZone: 'America/New_York',
      })
    ).toMatchObject({ days: 0, variant: 'sentToday' });

    expect(
      resolvePendingOfferState({
        proposedAt,
        viewedAt: null,
        hasShiftToday: false,
        nowMs,
        timeZone: 'UTC',
      })
    ).toMatchObject({ days: 1, variant: 'waiting' });
  });
});

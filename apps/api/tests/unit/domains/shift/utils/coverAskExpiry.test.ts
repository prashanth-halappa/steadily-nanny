/**
 * D-47's arithmetic, pinned. Every case here is a sentence from
 * docs/design/attention-and-notifications.md §5.2.
 */
import { describe, expect, it } from 'bun:test';
import {
  COVER_ASK_EXPIRY_HOURS,
  COVER_ASK_LEAD_HOURS,
  COVER_ASK_MIN_FUSE_HOURS,
  computeCoverAskExpiry,
} from '../../../../../src/domains/shift/utils/coverAskExpiry';

const HOUR = 60 * 60 * 1000;

/** ISO in, ISO out — the util is called with strings on both sides. */
function expiry(createdAt: string, startsAt: string): string {
  return computeCoverAskExpiry(createdAt, startsAt);
}

function hoursBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / HOUR;
}

describe('computeCoverAskExpiry (D-47)', () => {
  it('caps at 48h when the shift is far out', () => {
    const created = '2026-08-11T09:00:00.000Z';
    const starts = '2026-09-01T09:00:00.000Z'; // three weeks away
    expect(hoursBetween(created, expiry(created, starts))).toBe(
      COVER_ASK_EXPIRY_HOURS
    );
  });

  it('uses starts − 4h when that lands before the 48h cap', () => {
    const created = '2026-08-11T09:00:00.000Z';
    const starts = '2026-08-12T09:00:00.000Z'; // 24h out
    expect(expiry(created, starts)).toBe('2026-08-12T05:00:00.000Z');
  });

  it('THE CASE THE DECISION EXISTS FOR: a 21:00 ask for a 07:00 shift expires before the shift, not two days later', () => {
    const created = '2026-08-13T21:00:00.000Z';
    const starts = '2026-08-14T07:00:00.000Z';
    const result = expiry(created, starts);
    // 48h would land on the 15th, long after a two-year-old had nobody.
    expect(Date.parse(result)).toBeLessThan(Date.parse(starts));
    expect(result).toBe('2026-08-14T03:00:00.000Z');
  });

  it('collapses the lead to a 1h floor rather than going negative on a same-morning scramble', () => {
    // 3h of lead time: starts − 4h is BEFORE the ask was even created.
    const created = '2026-08-14T04:00:00.000Z';
    const starts = '2026-08-14T07:00:00.000Z';
    const result = expiry(created, starts);
    expect(Date.parse(result)).toBeGreaterThan(Date.parse(created));
    expect(result).toBe('2026-08-14T06:00:00.000Z'); // starts − 1h
  });

  it('inside the last hour the deadline IS the start — the two §5.2 rules collide and "at starts_at at the latest" wins', () => {
    // 30 minutes of lead. The 1h floor would put the deadline at 07:30, past
    // a shift that began at 07:00 — and a deadline in the past is fiction,
    // which is the stronger of the two rules. So the ask stays answerable
    // right up to the start and closes there.
    const created = '2026-08-14T06:30:00.000Z';
    const starts = '2026-08-14T07:00:00.000Z';
    expect(expiry(created, starts)).toBe(starts);
    expect(hoursBetween(created, expiry(created, starts))).toBeLessThan(
      COVER_ASK_MIN_FUSE_HOURS
    );
  });

  it('never expires after the shift has started — a sweep that expires a window already in the past is writing fiction', () => {
    // Pathological: asked five minutes before the start.
    const created = '2026-08-14T06:55:00.000Z';
    const starts = '2026-08-14T07:00:00.000Z';
    expect(Date.parse(expiry(created, starts))).toBeLessThanOrEqual(
      Date.parse(starts)
    );
  });

  it('clamps an ask created after the shift already started to the start instant', () => {
    const created = '2026-08-14T09:00:00.000Z';
    const starts = '2026-08-14T07:00:00.000Z';
    expect(expiry(created, starts)).toBe(starts);
  });

  it('compares instants, not strings — a PostgREST +00:00 fixture resolves identically (GOLDEN #25)', () => {
    const postgrest = expiry(
      '2026-08-11T09:00:00+00:00',
      '2026-08-12T09:00:00+00:00'
    );
    const jsIso = expiry(
      '2026-08-11T09:00:00.000Z',
      '2026-08-12T09:00:00.000Z'
    );
    expect(postgrest).toBe(jsIso);
  });

  it('always returns the .000Z serialisation, whatever it was handed', () => {
    expect(
      expiry('2026-08-11T09:00:00+00:00', '2026-09-01T09:00:00+00:00')
    ).toMatch(/\.\d{3}Z$/);
  });

  it('holds the constants D-47 names', () => {
    expect(COVER_ASK_EXPIRY_HOURS).toBe(48);
    expect(COVER_ASK_LEAD_HOURS).toBe(4);
    expect(COVER_ASK_MIN_FUSE_HOURS).toBe(1);
  });
});

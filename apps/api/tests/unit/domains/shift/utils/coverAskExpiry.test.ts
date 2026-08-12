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
const BASE = Date.now();

/** ISO in, ISO out — the util is called with strings on both sides. */
function expiry(createdAt: string, startsAt: string): string {
  return computeCoverAskExpiry(createdAt, startsAt);
}

function hoursBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / HOUR;
}

describe('computeCoverAskExpiry (D-47)', () => {
  it('caps at 48h when the shift is far out', () => {
    const created = new Date(BASE).toISOString();
    const starts = new Date(BASE + 21 * 24 * HOUR).toISOString(); // three weeks away
    expect(hoursBetween(created, expiry(created, starts))).toBe(
      COVER_ASK_EXPIRY_HOURS
    );
  });

  it('uses starts − 4h when that lands before the 48h cap', () => {
    const created = new Date(BASE).toISOString();
    const starts = new Date(BASE + 24 * HOUR).toISOString(); // 24h out
    expect(expiry(created, starts)).toBe(
      new Date(BASE + 20 * HOUR).toISOString()
    );
  });

  it('THE CASE THE DECISION EXISTS FOR: a 21:00 ask for a 07:00 shift expires before the shift, not two days later', () => {
    const created = new Date(BASE).toISOString();
    const starts = new Date(BASE + 10 * HOUR).toISOString();
    const result = expiry(created, starts);
    // 48h would land long after a two-year-old had nobody.
    expect(Date.parse(result)).toBeLessThan(Date.parse(starts));
    expect(result).toBe(new Date(BASE + 6 * HOUR).toISOString());
  });

  it('collapses the lead to a 1h floor rather than going negative on a same-morning scramble', () => {
    // 3h of lead time: starts − 4h is BEFORE the ask was even created.
    const created = new Date(BASE).toISOString();
    const starts = new Date(BASE + 3 * HOUR).toISOString();
    const result = expiry(created, starts);
    expect(Date.parse(result)).toBeGreaterThan(Date.parse(created));
    expect(result).toBe(new Date(BASE + 2 * HOUR).toISOString()); // starts − 1h
  });

  it('inside the last hour the deadline IS the start — the two §5.2 rules collide and "at starts_at at the latest" wins', () => {
    // 30 minutes of lead. The 1h floor would put the deadline past
    // a shift that began at starts — and a deadline in the past is fiction,
    // which is the stronger of the two rules. So the ask stays answerable
    // right up to the start and closes there.
    const created = new Date(BASE + 30 * 60 * 1000).toISOString();
    const starts = new Date(BASE + HOUR).toISOString();
    expect(expiry(created, starts)).toBe(starts);
    expect(hoursBetween(created, expiry(created, starts))).toBeLessThan(
      COVER_ASK_MIN_FUSE_HOURS
    );
  });

  it('never expires after the shift has started — a sweep that expires a window already in the past is writing fiction', () => {
    // Pathological: asked five minutes before the start.
    const created = new Date(BASE + 55 * 60 * 1000).toISOString();
    const starts = new Date(BASE + HOUR).toISOString();
    expect(Date.parse(expiry(created, starts))).toBeLessThanOrEqual(
      Date.parse(starts)
    );
  });

  it('clamps an ask created after the shift already started to the start instant', () => {
    const created = new Date(BASE + 2 * HOUR).toISOString();
    const starts = new Date(BASE + HOUR).toISOString();
    expect(expiry(created, starts)).toBe(starts);
  });

  it('compares instants, not strings — a PostgREST +00:00 fixture resolves identically (GOLDEN #25)', () => {
    const createdZ = new Date(BASE).toISOString();
    const startsZ = new Date(BASE + 24 * HOUR).toISOString();
    const postgrest = expiry(
      createdZ.replace('.000Z', '+00:00'),
      startsZ.replace('.000Z', '+00:00')
    );
    const jsIso = expiry(createdZ, startsZ);
    expect(postgrest).toBe(jsIso);
  });

  it('always returns the .000Z serialisation, whatever it was handed', () => {
    expect(
      expiry(
        new Date(BASE).toISOString().replace('.000Z', '+00:00'),
        new Date(BASE + 21 * 24 * HOUR).toISOString().replace('.000Z', '+00:00')
      )
    ).toMatch(/\.\d{3}Z$/);
  });

  it('holds the constants D-47 names', () => {
    expect(COVER_ASK_EXPIRY_HOURS).toBe(48);
    expect(COVER_ASK_LEAD_HOURS).toBe(4);
    expect(COVER_ASK_MIN_FUSE_HOURS).toBe(1);
  });
});

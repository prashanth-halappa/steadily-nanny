/**
 * @module lib/__tests__/displayTime.zoneLabel
 *
 * P15: the label that tells a nanny whose clock the hours are quoted in.
 * Pinned against a specific zone, never the runner's default (#29).
 */
import { describe, expect, it } from 'bun:test';
import { shortZoneLabel } from '@/src/lib/displayTime';

describe('shortZoneLabel', () => {
  it('names the household zone in summer and in winter', () => {
    expect(
      shortZoneLabel('Europe/London', new Date('2026-08-21T12:00:00Z'))
    ).toBe('GMT+1');
    expect(
      shortZoneLabel('Europe/London', new Date('2026-01-21T12:00:00Z'))
    ).toBe('GMT');
  });

  it('differs from the reader device zone rather than echoing it', () => {
    const london = shortZoneLabel(
      'Europe/London',
      new Date('2026-08-21T12:00:00Z')
    );
    const la = shortZoneLabel(
      'America/Los_Angeles',
      new Date('2026-08-21T12:00:00Z')
    );
    expect(london).not.toBe(la);
  });

  it('returns null for an unrecognized zone so callers render nothing', () => {
    expect(shortZoneLabel('Not/AZone')).toBeNull();
  });
});

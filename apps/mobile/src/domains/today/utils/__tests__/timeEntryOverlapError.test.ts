/**
 * @module domains/today/utils/__tests__/timeEntryOverlapError
 *
 * Overlap 409 envelope parsing + toast formatting. The carer needs the
 * conflicting entry's day/range (not a raw UUID) so she can find it on Hours
 * while still stuck on the clock.
 */
import { describe, expect, it } from 'bun:test';
import {
  formatTimeEntryOverlapMessage,
  getOverlappingEntry,
} from '../timeEntryOverlapError';

const OVERLAP_ID = '635fc59a-72a6-4a76-b4a7-25255ede4152';
const OVERLAP_IN = '2026-08-03T08:00:00.000Z';
const OVERLAP_OUT = '2026-08-03T16:00:00.000Z';

function overlapEnvelope(metadata: Record<string, unknown>) {
  return {
    response: {
      status: 409,
      data: {
        error: {
          code: 'CONFLICT',
          metadata,
        },
      },
    },
  };
}

describe('getOverlappingEntry', () => {
  it('extracts id + both times from a well-formed 409 overlap envelope', () => {
    const result = getOverlappingEntry(
      overlapEnvelope({
        reason: 'TIME_ENTRY_OVERLAPS',
        overlappingEntryId: OVERLAP_ID,
        overlappingClockInAt: OVERLAP_IN,
        overlappingClockOutAt: OVERLAP_OUT,
      })
    );
    expect(result).toEqual({
      id: OVERLAP_ID,
      clockInAt: OVERLAP_IN,
      clockOutAt: OVERLAP_OUT,
    });
  });

  // A missing finish is not a degraded envelope — the conflicting entry is
  // still running (she forgot to clock out and is typing the hours in by
  // hand), which is its own message rather than a generic conflict.
  it('reports a missing finish as a still-running conflict, not null', () => {
    expect(
      getOverlappingEntry(
        overlapEnvelope({
          reason: 'TIME_ENTRY_OVERLAPS',
          overlappingEntryId: OVERLAP_ID,
          overlappingClockInAt: OVERLAP_IN,
        })
      )
    ).toEqual({ id: OVERLAP_ID, clockInAt: OVERLAP_IN, clockOutAt: null });
  });

  it('degrades a non-string finish to null rather than dropping the entry', () => {
    expect(
      getOverlappingEntry(
        overlapEnvelope({
          reason: 'TIME_ENTRY_OVERLAPS',
          overlappingEntryId: OVERLAP_ID,
          overlappingClockInAt: OVERLAP_IN,
          overlappingClockOutAt: 1234,
        })
      )
    ).toEqual({ id: OVERLAP_ID, clockInAt: OVERLAP_IN, clockOutAt: null });
  });

  it('returns null when the metadata omits the id or the start', () => {
    expect(
      getOverlappingEntry(
        overlapEnvelope({
          reason: 'TIME_ENTRY_OVERLAPS',
          overlappingClockInAt: OVERLAP_IN,
        })
      )
    ).toBeNull();
    expect(
      getOverlappingEntry(
        overlapEnvelope({
          reason: 'TIME_ENTRY_OVERLAPS',
          overlappingEntryId: OVERLAP_ID,
        })
      )
    ).toBeNull();
  });

  it('returns null for a non-409 response', () => {
    expect(
      getOverlappingEntry({
        response: {
          status: 500,
          data: {
            error: {
              metadata: {
                reason: 'TIME_ENTRY_OVERLAPS',
                overlappingEntryId: OVERLAP_ID,
                overlappingClockInAt: OVERLAP_IN,
                overlappingClockOutAt: OVERLAP_OUT,
              },
            },
          },
        },
      })
    ).toBeNull();
  });

  it('returns null when reason is not TIME_ENTRY_OVERLAPS', () => {
    expect(
      getOverlappingEntry(
        overlapEnvelope({
          reason: 'ALREADY_CLOCKED_IN',
          overlappingEntryId: OVERLAP_ID,
          overlappingClockInAt: OVERLAP_IN,
          overlappingClockOutAt: OVERLAP_OUT,
        })
      )
    ).toBeNull();
  });
});

describe('formatTimeEntryOverlapMessage', () => {
  it('interpolates day and range, and never appends a UUID', () => {
    const t = (
      _key: string,
      options?: { day: string; range?: string }
    ): string =>
      `That finish overlaps another entry on ${options?.day} (${options?.range}). Still on the clock.`;

    const message = formatTimeEntryOverlapMessage(
      t,
      'Mon 3 Aug',
      '08:00–16:00'
    );
    expect(message).toContain('Mon 3 Aug');
    expect(message).toContain('08:00–16:00');
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('under a key-echo mock, still surfaces day and range (no UUID fallback)', () => {
    // Same shape as bun.setup.ts's react-i18next mock — returns the key and
    // ignores options. The old entryId-append fallback must not return.
    const t = (key: string) => key;
    const message = formatTimeEntryOverlapMessage(
      t,
      'Mon 3 Aug',
      '08:00–16:00'
    );
    expect(message).toContain('Mon 3 Aug');
    expect(message).toContain('08:00–16:00');
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  // The conflicting entry is still running: there is no range to show, and
  // the fix is to clock out of it, not to shorten it.
  it('uses the still-running key when the range is null', () => {
    const keys: string[] = [];
    const t = (key: string, options?: { day: string; range?: string }) => {
      keys.push(key);
      return `That clashes with a shift you're still clocked into on ${options?.day}.`;
    };

    const message = formatTimeEntryOverlapMessage(t, 'Mon 3 Aug', null);
    expect(keys).toEqual(['timeEntryOverlapsRunning']);
    expect(message).toContain('Mon 3 Aug');
    expect(message).not.toContain('undefined');
  });

  it('under a key-echo mock, the running case still surfaces the day', () => {
    const t = (key: string) => key;
    const message = formatTimeEntryOverlapMessage(t, 'Mon 3 Aug', null);
    expect(message).toContain('timeEntryOverlapsRunning');
    expect(message).toContain('Mon 3 Aug');
  });
});

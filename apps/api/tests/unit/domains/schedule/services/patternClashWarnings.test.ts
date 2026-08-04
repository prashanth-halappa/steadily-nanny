/**
 * @module tests/unit/domains/schedule/services/patternClashWarnings.test
 */

import { describe, expect, it, mock } from 'bun:test';
import type { ClashWarning } from '@steadily-nanny/shared-types/schemas/me.schema';
import type { BusyBlockWithSource } from '../../../../../src/domains/availability/repositories/busyBlockRepository';
import { collectClashWarnings } from '../../../../../src/domains/me/services/clashWarning';
import {
  type CollectPatternClashWarnings,
  collectClashWarningsForPattern,
  patternWithAmendOverlay,
} from '../../../../../src/domains/schedule/services/patternClashWarnings';
import { deriveOccurrenceIcalUid } from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';

const basePattern = {
  id: 'p1',
  household_id: 'h1',
  carer_id: 'carer-1',
  rrule: 'FREQ=WEEKLY;INTERVAL=1',
  dtstart: '2026-08-03',
  until: null,
  exdates: [] as string[],
  pause_ranges: [] as Array<{ from: string; to: string }>,
  timezone: 'UTC',
  status: 'pending' as const,
  note: null,
  ical_uid: 'p1@test',
  sequence: 0,
  sent_at: null,
  responded_at: null,
  decline_message: null,
  created_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  days: [
    {
      id: 'd1',
      pattern_id: 'p1',
      weekday: 1,
      start_time: '09:00:00',
      end_time: '17:00:00',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      children: [],
    },
  ],
} as Parameters<typeof collectClashWarningsForPattern>[0];

const NOW = new Date('2026-08-03T12:00:00.000Z');

/** Records the (carerId, proposed, options) triples the SUT collects with. */
function capturingCollect() {
  return mock(
    async (
      _carerId: string,
      _proposed: { startsAt: string; endsAt: string; timezone: string },
      _options?: { ignoreExact?: { sourceUid: string } }
    ): Promise<ClashWarning[]> => []
  );
}

/**
 * One busy block sitting exactly on the pattern's first occurrence — what an
 * already-materialised `accepted` pattern looks like in `v_busy_blocks`. The
 * uid is derived here independently of what the SUT passes, so a wrong
 * `ignoreExact` fails rather than matching itself.
 */
async function busyBlockAtFirstOccurrence(
  sourceUid: (ownUid: string) => string
): Promise<BusyBlockWithSource[]> {
  const collect = capturingCollect();
  await collectClashWarningsForPattern(basePattern, NOW, collect);
  const call = collect.mock.calls[0];
  if (!call) throw new Error('expected at least one occurrence');
  const proposed = call[1];
  return [
    {
      starts_at: proposed.startsAt,
      ends_at: proposed.endsAt,
      kind: 'other_commitment',
      source_uid: sourceUid(
        deriveOccurrenceIcalUid(
          basePattern.ical_uid,
          proposed.startsAt.slice(0, 10)
        )
      ),
    },
  ];
}

/** Runs the REAL pure collector against a fixed busy-block set. */
function collectAgainst(
  busyBlocks: BusyBlockWithSource[]
): CollectPatternClashWarnings {
  return async (_carerId, proposed, options) =>
    collectClashWarnings({
      proposed,
      busyBlocks,
      availability: [],
      ignoreExact: options?.ignoreExact,
    });
}

describe('collectClashWarningsForPattern', () => {
  it('returns [] when there is no carer', async () => {
    const collect = mock(async () => [
      { kind: 'outside_availability' as const },
    ]);
    const warnings = await collectClashWarningsForPattern(
      { ...basePattern, carer_id: null },
      new Date('2026-08-03T12:00:00.000Z'),
      collect
    );
    expect(warnings).toEqual([]);
    expect(collect).not.toHaveBeenCalled();
  });

  it('returns [] when the pattern has no days', async () => {
    const collect = mock(async () => [
      { kind: 'outside_availability' as const },
    ]);
    const warnings = await collectClashWarningsForPattern(
      { ...basePattern, days: [] },
      new Date('2026-08-03T12:00:00.000Z'),
      collect
    );
    expect(warnings).toEqual([]);
    expect(collect).not.toHaveBeenCalled();
  });

  it('dedupes outside_availability across weekday occurrences', async () => {
    const collect = mock(async () => [
      { kind: 'outside_availability' as const },
    ]);
    const warnings = await collectClashWarningsForPattern(
      basePattern,
      new Date('2026-08-03T12:00:00.000Z'),
      collect
    );
    expect(collect.mock.calls.length).toBeGreaterThan(0);
    expect(
      warnings.filter(w => w.kind === 'outside_availability')
    ).toHaveLength(1);
  });

  it('passes each occurrence its own derived ical_uid as ignoreExact', async () => {
    const collect = capturingCollect();
    await collectClashWarningsForPattern(basePattern, NOW, collect);

    expect(collect.mock.calls.length).toBeGreaterThan(0);
    for (const [, proposed, options] of collect.mock.calls) {
      expect(options?.ignoreExact?.sourceUid).toBe(
        // timezone is UTC in this fixture, so the local date is the ISO prefix.
        deriveOccurrenceIcalUid(
          basePattern.ical_uid,
          proposed.startsAt.slice(0, 10)
        )
      );
    }
  });

  it('does not warn against the pattern own already-materialised occurrences', async () => {
    const warnings = await collectClashWarningsForPattern(
      basePattern,
      NOW,
      collectAgainst(await busyBlockAtFirstOccurrence(uid => uid))
    );
    expect(warnings.filter(w => w.kind === 'busy_overlap')).toEqual([]);
  });

  it('still warns on an overlapping block from another source', async () => {
    const warnings = await collectClashWarningsForPattern(
      basePattern,
      NOW,
      collectAgainst(await busyBlockAtFirstOccurrence(() => 'other@household'))
    );
    expect(warnings.filter(w => w.kind === 'busy_overlap')).toHaveLength(1);
  });

  it('patternWithAmendOverlay overlays exdates/pause_ranges/until for pre-materialise warnings', () => {
    const overlaid = patternWithAmendOverlay(basePattern, {
      exdates: ['2026-08-10'],
      until: '2026-09-01',
    });
    expect(overlaid.exdates).toEqual(['2026-08-10']);
    expect(overlaid.until).toBe('2026-09-01');
    expect(overlaid.pause_ranges).toEqual(basePattern.pause_ranges);
    expect(overlaid.days).toBe(basePattern.days);
  });
});

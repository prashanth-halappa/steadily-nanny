/**
 * Clash warning helpers — overlaps warn, never block (migration 015 stance).
 * @module tests/unit/domains/me/services/clashWarning.test
 */
import { describe, expect, it, mock } from 'bun:test';
import {
  collectClashWarnings,
  collectClashWarningsForCarer,
  intervalsOverlap,
  isOutsideAvailability,
} from '../../../../../src/domains/me/services/clashWarning';
import { ConflictError } from '../../../../../src/errors';

describe('intervalsOverlap', () => {
  it('detects partial overlap and excludes touching-only intervals', () => {
    expect(
      intervalsOverlap(
        '2026-08-03T08:00:00.000Z',
        '2026-08-03T12:00:00.000Z',
        '2026-08-03T11:00:00.000Z',
        '2026-08-03T15:00:00.000Z'
      )
    ).toBe(true);
    expect(
      intervalsOverlap(
        '2026-08-03T08:00:00.000Z',
        '2026-08-03T12:00:00.000Z',
        '2026-08-03T12:00:00.000Z',
        '2026-08-03T15:00:00.000Z'
      )
    ).toBe(false);
  });
});

describe('isOutsideAvailability', () => {
  const mondayAvailable = [
    {
      weekday: 1, // Monday
      is_available: true,
      earliest_start: '09:00:00',
      latest_finish: '17:00:00',
    },
  ];

  it('flags a London Monday shift that starts before earliest_start', () => {
    // 2026-08-03 is a Monday; 08:00 London in August is 07:00Z.
    expect(
      isOutsideAvailability(
        {
          startsAt: '2026-08-03T07:00:00.000Z',
          endsAt: '2026-08-03T16:00:00.000Z',
          timezone: 'Europe/London',
        },
        mondayAvailable
      )
    ).toBe(true);
  });

  it('does not flag a shift fully inside the marked window', () => {
    expect(
      isOutsideAvailability(
        {
          startsAt: '2026-08-03T08:00:00.000Z', // 09:00 London
          endsAt: '2026-08-03T16:00:00.000Z', // 17:00 London
          timezone: 'Europe/London',
        },
        mondayAvailable
      )
    ).toBe(false);
  });

  it('flags a weekday with no availability row', () => {
    expect(
      isOutsideAvailability(
        {
          startsAt: '2026-08-04T08:00:00.000Z', // Tuesday
          endsAt: '2026-08-04T16:00:00.000Z',
          timezone: 'Europe/London',
        },
        mondayAvailable
      )
    ).toBe(true);
  });

  it('checks end weekday for overnight shifts (not start weekday only)', () => {
    // Mon 22:00 → Tue 02:00 London. Monday window covers the start; Tuesday
    // has no row — must still flag outside_availability.
    const mondayLate = [
      {
        weekday: 1,
        is_available: true,
        earliest_start: '09:00:00',
        latest_finish: '23:00:00',
      },
    ];
    expect(
      isOutsideAvailability(
        {
          startsAt: '2026-08-03T21:00:00.000Z', // 22:00 London Monday
          endsAt: '2026-08-04T01:00:00.000Z', // 02:00 London Tuesday
          timezone: 'Europe/London',
        },
        mondayLate
      )
    ).toBe(true);

    const bothDays = [
      ...mondayLate,
      {
        weekday: 2,
        is_available: true,
        earliest_start: '00:00:00',
        latest_finish: '17:00:00',
      },
    ];
    expect(
      isOutsideAvailability(
        {
          startsAt: '2026-08-03T21:00:00.000Z',
          endsAt: '2026-08-04T01:00:00.000Z',
          timezone: 'Europe/London',
        },
        bothDays
      )
    ).toBe(false);
  });
});

describe('collectClashWarnings', () => {
  it('returns busy_overlap and outside_availability warnings without throwing', () => {
    const warnings = collectClashWarnings({
      proposed: {
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
        timezone: 'Europe/London',
      },
      busyBlocks: [
        {
          starts_at: '2026-08-03T10:00:00.000Z',
          ends_at: '2026-08-03T12:00:00.000Z',
          kind: 'other_commitment',
          source_uid: 'other@steadily',
        },
      ],
      availability: [
        {
          weekday: 1,
          is_available: true,
          earliest_start: '09:00:00',
          latest_finish: '17:00:00',
        },
      ],
    });

    expect(warnings.some(w => w.kind === 'busy_overlap')).toBe(true);
    expect(warnings.some(w => w.kind === 'outside_availability')).toBe(true);
    expect(() =>
      collectClashWarnings({
        proposed: {
          startsAt: '2026-08-03T07:00:00.000Z',
          endsAt: '2026-08-03T16:00:00.000Z',
          timezone: 'Europe/London',
        },
        busyBlocks: [
          {
            starts_at: '2026-08-03T10:00:00.000Z',
            ends_at: '2026-08-03T12:00:00.000Z',
            kind: 'time_off',
            source_uid: 'time-off@steadily',
          },
        ],
        availability: [],
      })
    ).not.toThrow();
  });

  it('ignores the block with matching source_uid so editing a shift is not a self-clash', () => {
    const warnings = collectClashWarnings({
      proposed: {
        startsAt: '2026-08-03T08:00:00.000Z',
        endsAt: '2026-08-03T17:00:00.000Z',
        timezone: 'Europe/London',
      },
      busyBlocks: [
        {
          starts_at: '2026-08-03T08:00:00.000Z',
          ends_at: '2026-08-03T17:00:00.000Z',
          kind: 'other_commitment',
          source_uid: 'self-shift@steadily',
        },
      ],
      availability: [
        {
          weekday: 1,
          is_available: true,
          earliest_start: null,
          latest_finish: null,
        },
      ],
      ignoreExact: { sourceUid: 'self-shift@steadily' },
    });
    expect(warnings.filter(w => w.kind === 'busy_overlap')).toEqual([]);
  });

  it('still warns when an identical-time block has a different source_uid', () => {
    // Matching by opaque source_uid (not wall times) means another household's
    // identical window is a real clash, not swallowed as "self".
    const warnings = collectClashWarnings({
      proposed: {
        startsAt: '2026-08-03T08:00:00.000Z',
        endsAt: '2026-08-03T17:00:00.000Z',
        timezone: 'Europe/London',
      },
      busyBlocks: [
        {
          starts_at: '2026-08-03T08:00:00.000Z',
          ends_at: '2026-08-03T17:00:00.000Z',
          kind: 'other_commitment',
          source_uid: 'self-shift@steadily',
        },
        {
          starts_at: '2026-08-03T08:00:00.000Z',
          ends_at: '2026-08-03T17:00:00.000Z',
          kind: 'other_commitment',
          source_uid: 'other-household@steadily',
        },
      ],
      availability: [
        {
          weekday: 1,
          is_available: true,
          earliest_start: null,
          latest_finish: null,
        },
      ],
      ignoreExact: { sourceUid: 'self-shift@steadily' },
    });
    const overlaps = warnings.filter(w => w.kind === 'busy_overlap');
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({
      starts_at: '2026-08-03T08:00:00.000Z',
      ends_at: '2026-08-03T17:00:00.000Z',
      busy_kind: 'other_commitment',
    });
  });

  it('never throws a ConflictError (or any blocking domain error) for overlaps', () => {
    expect(() =>
      collectClashWarnings({
        proposed: {
          startsAt: '2026-08-03T08:00:00.000Z',
          endsAt: '2026-08-03T17:00:00.000Z',
          timezone: 'Europe/London',
        },
        busyBlocks: [
          {
            starts_at: '2026-08-03T09:00:00.000Z',
            ends_at: '2026-08-03T10:00:00.000Z',
            kind: 'personal',
            source_uid: 'personal@steadily',
          },
          {
            starts_at: '2026-08-03T14:00:00.000Z',
            ends_at: '2026-08-03T15:00:00.000Z',
            kind: 'time_off',
            source_uid: 'time-off@steadily',
          },
        ],
        availability: [
          {
            weekday: 1,
            is_available: false,
            earliest_start: null,
            latest_finish: null,
          },
        ],
      })
    ).not.toThrow(ConflictError);
  });

  it('does not emit outside_availability when the carer has no availability rows', () => {
    // Empty availability ⇒ carer never configured windows; do not spam
    // OUTSIDE_AVAILABILITY on every write (server-side, not client filter).
    const warnings = collectClashWarnings({
      proposed: {
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
        timezone: 'Europe/London',
      },
      busyBlocks: [
        {
          starts_at: '2026-08-03T10:00:00.000Z',
          ends_at: '2026-08-03T12:00:00.000Z',
          kind: 'other_commitment',
          source_uid: 'other@steadily',
        },
      ],
      availability: [],
    });
    expect(warnings.some(w => w.kind === 'busy_overlap')).toBe(true);
    expect(warnings.some(w => w.kind === 'outside_availability')).toBe(false);
  });
});

describe('collectClashWarningsForCarer', () => {
  it('consults busy blocks and availability, returning warnings only', async () => {
    const busyRepo = {
      listForClashEvaluation: mock(async () => [
        {
          starts_at: '2026-08-03T10:00:00.000Z',
          ends_at: '2026-08-03T12:00:00.000Z',
          kind: 'other_commitment' as const,
          source_uid: 'other@steadily',
        },
      ]),
    };
    const availabilityRepo = {
      findByUserId: mock(async () => [
        {
          id: 'a1',
          user_id: 'nanny-1',
          weekday: 1,
          is_available: true,
          earliest_start: '09:00:00',
          latest_finish: '17:00:00',
          evening_mode: 'never' as const,
          created_at: 't',
          updated_at: 't',
        },
      ]),
    };

    const warnings = await collectClashWarningsForCarer(
      'nanny-1',
      {
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
        timezone: 'Europe/London',
      },
      {},
      { busyRepo, availabilityRepo }
    );

    expect(busyRepo.listForClashEvaluation).toHaveBeenCalledWith(
      'nanny-1',
      '2026-08-03T07:00:00.000Z',
      '2026-08-03T16:00:00.000Z'
    );
    expect(availabilityRepo.findByUserId).toHaveBeenCalledWith('nanny-1');
    expect(warnings.some(w => w.kind === 'busy_overlap')).toBe(true);
    expect(warnings.some(w => w.kind === 'outside_availability')).toBe(true);
    await expect(
      collectClashWarningsForCarer(
        'nanny-1',
        {
          startsAt: '2026-08-03T07:00:00.000Z',
          endsAt: '2026-08-03T16:00:00.000Z',
          timezone: 'Europe/London',
        },
        {},
        { busyRepo, availabilityRepo }
      )
    ).resolves.toBeArray();
  });

  it('returns [] when busy-block or availability repo fails (advisory, never 500)', async () => {
    const busyRepo = {
      listForClashEvaluation: mock(async () => {
        throw new Error('v_busy_blocks unavailable');
      }),
    };
    const availabilityRepo = {
      findByUserId: mock(async () => {
        throw new Error('availability unavailable');
      }),
    };

    await expect(
      collectClashWarningsForCarer(
        'nanny-1',
        {
          startsAt: '2026-08-03T07:00:00.000Z',
          endsAt: '2026-08-03T16:00:00.000Z',
          timezone: 'Europe/London',
        },
        {},
        { busyRepo, availabilityRepo }
      )
    ).resolves.toEqual([]);
  });
});

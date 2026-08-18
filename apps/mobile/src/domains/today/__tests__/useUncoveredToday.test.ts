/**
 * @module domains/today/__tests__/useUncoveredToday.test
 *
 * Pure `computeUncoveredToday` — zero need windows on a day (commitments exist
 * but none apply today) must not read as "covered".
 */
import { describe, expect, it } from 'bun:test';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import { computeUncoveredToday } from '../hooks/useUncoveredToday';

const TZ = 'Europe/London';
const MONDAY = '2026-03-23';
const SATURDAY = '2026-03-28';
const CHILD_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeCommitment(
  overrides: Partial<ChildCommitment> = {}
): ChildCommitment {
  return {
    id: COMMITMENT_ID,
    child_id: CHILD_A,
    household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
    kind: 'school',
    label: null,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    start_time: '09:00:00',
    end_time: '17:00:00',
    starts_on: null,
    ends_on: null,
    exdates: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeUncoveredToday', () => {
  it('returns setup when no commitments exist', () => {
    expect(
      computeUncoveredToday({
        localDate: MONDAY,
        timezone: TZ,
        commitments: [],
        shifts: [],
        closures: [],
      })
    ).toEqual({ status: 'setup' });
  });

  it('returns noNeedToday when commitments exist but none apply on the local date', () => {
    expect(
      computeUncoveredToday({
        localDate: SATURDAY,
        timezone: TZ,
        commitments: [makeCommitment()],
        shifts: [],
        closures: [],
      })
    ).toEqual({
      status: 'noNeedToday',
      localDate: SATURDAY,
      weekday: 6,
    });
  });

  it('returns covered when need windows apply and shifts cover them', () => {
    const commitment = makeCommitment({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    });
    expect(
      computeUncoveredToday({
        localDate: MONDAY,
        timezone: TZ,
        commitments: [commitment],
        shifts: [
          {
            id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
            household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
            carer_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            created_by: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
            kind: 'recurring',
            status: 'confirmed',
            origin: 'system_generated',
            starts_at: '2026-03-23T09:00:00.000Z',
            ends_at: '2026-03-23T17:00:00.000Z',
            timezone: TZ,
            local_date: MONDAY,
            is_short_notice: false,
            source_pattern_id: null,
            note: null,
            reason: null,
            cancelled_at: null,
            cancelled_by: null,
            cancellation_paid: false,
            cancellation_message: null,
            ical_uid: 'shift@test',
            sequence: 0,
            shift_children: [
              {
                id: 'sc-1',
                shift_id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
                child_id: CHILD_A,
                starts_at: '2026-03-23T09:00:00.000Z',
                ends_at: '2026-03-23T17:00:00.000Z',
                created_at: '2026-01-01T00:00:00.000Z',
              },
            ],
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        closures: [],
      })
    ).toEqual({ status: 'covered', localDate: MONDAY });
  });

  it('drops windows that have already ended (the 8pm "9:00 AM to 3:00 PM" card)', () => {
    const args = {
      localDate: MONDAY,
      timezone: TZ,
      commitments: [makeCommitment({ end_time: '15:00:00' })],
      shifts: [],
      closures: [],
    };
    // Midday: the gap is still live.
    expect(
      computeUncoveredToday({
        ...args,
        nowMs: Date.parse('2026-03-23T12:00:00.000Z'),
      }).status
    ).toBe('uncovered');
    // 8pm, five hours after it closed: nothing left to act on.
    expect(
      computeUncoveredToday({
        ...args,
        nowMs: Date.parse('2026-03-23T20:00:00.000Z'),
      }).status
    ).toBe('covered');
  });
});

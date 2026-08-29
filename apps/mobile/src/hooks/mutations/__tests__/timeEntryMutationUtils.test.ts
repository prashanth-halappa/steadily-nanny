/**
 * @module hooks/mutations/__tests__/timeEntryMutationUtils.test
 *
 * A1 — optimistic running-entry helpers must work in React Native (expo-crypto,
 * local calendar date) and mark provisional cache rows so clock-out can refuse them.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';

const randomUuidMock = mock(() => '00000000-0000-4000-8000-000000000abc');

mock.module('expo-crypto', () => ({
  randomUUID: randomUuidMock,
}));

let buildOptimisticRunningEntry: typeof import('../timeEntryMutationUtils').buildOptimisticRunningEntry;
let isOptimisticTimeEntry: typeof import('../timeEntryMutationUtils').isOptimisticTimeEntry;
let getTimeEntryEditErrorKey: typeof import('../timeEntryMutationUtils').getTimeEntryEditErrorKey;

beforeEach(async () => {
  randomUuidMock.mockClear();
  ({
    buildOptimisticRunningEntry,
    isOptimisticTimeEntry,
    getTimeEntryEditErrorKey,
  } = await import('../timeEntryMutationUtils'));
});

afterEach(() => {
  setSystemTime();
});

describe('timeEntryMutationUtils — A1 optimistic entry', () => {
  it('builds a provisional running entry via expo-crypto and localDate helpers', () => {
    const entry = buildOptimisticRunningEntry({
      household_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(randomUuidMock).toHaveBeenCalled();
    expect(entry.id).toBe('00000000-0000-4000-8000-000000000abc');
    expect(entry.isOptimistic).toBe(true);
    expect(entry.local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // F-B8-6: a carer travelling away from her household's zone got an
  // optimistic row stamped with the DEVICE zone, so the row she stares at
  // until the server answers can sit in the wrong day bucket entirely.
  it('stamps the household zone and its calendar date, not the device zone', () => {
    // 22:00 UTC on the 5th is already 10:00 on the 6th in Auckland (UTC+12).
    setSystemTime(new Date('2026-08-05T22:00:00Z'));

    const entry = buildOptimisticRunningEntry(
      { household_id: '00000000-0000-4000-8000-000000000001' },
      'Pacific/Auckland'
    );

    expect(entry.timezone).toBe('Pacific/Auckland');
    expect(entry.local_date).toBe('2026-08-06');
  });

  it('falls back to the device zone when no household zone is known', () => {
    const entry = buildOptimisticRunningEntry({
      household_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(entry.timezone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  });

  it('isOptimisticTimeEntry identifies provisional cache rows', () => {
    const optimistic = buildOptimisticRunningEntry({
      household_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(isOptimisticTimeEntry(optimistic)).toBe(true);
    expect(
      isOptimisticTimeEntry({ ...optimistic, isOptimistic: undefined })
    ).toBe(false);
  });
});

// Every refusal a carer can hit while fixing her own pay record needs copy
// she can act on. A 16h span and a week-crossing finish used to fall through
// to `errors:validation` ("check the information you entered"), which names
// neither the cap nor the week.
describe('getTimeEntryEditErrorKey', () => {
  function refusal(status: number, reason: string) {
    return { response: { status, data: { error: { metadata: { reason } } } } };
  }

  /**
   * The shape the server ACTUALLY sends for a not-editable refusal: `reason`
   * is always the error code, and which of the four refusals it was lives in
   * `editableReason` (`timesheetErrors.ts`). Tests used to put the sub-reason
   * in `reason`, where nothing ever puts it.
   */
  function notEditable(status: number, editableReason: string) {
    return {
      response: {
        status,
        data: {
          error: {
            metadata: { reason: 'TIME_ENTRY_NOT_EDITABLE', editableReason },
          },
        },
      },
    };
  }

  it('maps a 16h-cap refusal to its own key', () => {
    expect(getTimeEntryEditErrorKey(refusal(400, 'CLOCK_SPAN_TOO_LONG'))).toBe(
      'errors:clockSpanTooLong'
    );
  });

  it('maps a finish that would change the week to its own key', () => {
    expect(
      getTimeEntryEditErrorKey(refusal(400, 'CLOCK_OUT_CHANGES_WEEK'))
    ).toBe('errors:clockOutChangesWeek');
  });

  it('keeps the plain bad-time reasons on invalidClockTimes', () => {
    for (const reason of [
      'CLOCK_OUT_BEFORE_CLOCK_IN',
      'CLOCK_OUT_IN_FUTURE',
      'CLOCK_IN_IN_FUTURE',
    ]) {
      expect(getTimeEntryEditErrorKey(refusal(400, reason))).toBe(
        'errors:invalidClockTimes'
      );
    }
  });

  // Each of these describes a DIFFERENT problem and used to render the
  // generic times sentence, which describes none of them.
  it('gives each week-boundary refusal the end that actually crossed', () => {
    expect(
      getTimeEntryEditErrorKey(refusal(400, 'CLOCK_IN_CHANGES_WEEK'))
    ).toBe('errors:clockInChangesWeek');
    expect(getTimeEntryEditErrorKey(refusal(400, 'CLOCK_CROSSES_WEEK'))).toBe(
      'errors:clockCrossesWeek'
    );
  });

  it('does not tell her to retype a start the row never had', () => {
    expect(getTimeEntryEditErrorKey(refusal(400, 'MISSING_CLOCK_TIME'))).toBe(
      'errors:missingClockTime'
    );
  });

  it('forks the not-editable 409 on the sub-reason, not the code', () => {
    expect(getTimeEntryEditErrorKey(notEditable(409, 'week_approved'))).toBe(
      'errors:entryNotEditableApproved'
    );
    expect(
      getTimeEntryEditErrorKey(notEditable(409, 'cancellation_paid'))
    ).toBe('errors:entryNotEditableCancelled');
    // 'running' has no sentence of its own — only a client bug reaches it.
    expect(getTimeEntryEditErrorKey(notEditable(409, 'running'))).toBe(
      'errors:entryNotEditable'
    );
  });

  it('falls back to the bare sentence when no sub-reason is present', () => {
    expect(
      getTimeEntryEditErrorKey(refusal(409, 'TIME_ENTRY_NOT_EDITABLE'))
    ).toBe('errors:entryNotEditable');
  });

  // A1/A9. The API guard is on the RECORD, not the button, so it refuses
  // `createRetroactiveEntry` and `updateEntry` with the same 409 it gives
  // `clockIn` — and this mapping is what makes "Add missed hours" say the
  // card's own sentence instead of "that conflicts with the current state".
  // Never a code, never "forbidden".
  it('maps the terms-gate 409 to the same sentence the blocked card leads with', () => {
    expect(getTimeEntryEditErrorKey(refusal(409, 'TERMS_NOT_AGREED'))).toBe(
      'errors:termsNotAgreed'
    );
  });

  // This branch was unreachable until the fork above read the right key:
  // 'voided' only ever arrives as `editableReason`.
  it('reaches the voided copy, which the old mapping could never fire', () => {
    expect(getTimeEntryEditErrorKey(notEditable(409, 'voided'))).toBe(
      'errors:entryVoided'
    );
    expect(getTimeEntryEditErrorKey(notEditable(400, 'voided'))).toBe(
      'errors:entryVoided'
    );
  });

  it('returns undefined for a non-400 status or an unknown reason', () => {
    expect(
      getTimeEntryEditErrorKey(refusal(409, 'CLOCK_SPAN_TOO_LONG'))
    ).toBeUndefined();
    expect(
      getTimeEntryEditErrorKey(refusal(400, 'SOMETHING_ELSE'))
    ).toBeUndefined();
    expect(getTimeEntryEditErrorKey(new Error('boom'))).toBeUndefined();
  });
});

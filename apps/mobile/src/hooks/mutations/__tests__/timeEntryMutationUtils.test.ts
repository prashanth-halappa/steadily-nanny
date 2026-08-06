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

beforeEach(async () => {
  randomUuidMock.mockClear();
  ({ buildOptimisticRunningEntry, isOptimisticTimeEntry } = await import(
    '../timeEntryMutationUtils'
  ));
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

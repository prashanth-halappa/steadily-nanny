/**
 * D-5 / §11.1.1's "nothing unusual this week" fast path.
 *
 * `nothingUnusualForWeek` is pure — plain data in, a boolean out, case-tabled
 * like `earningsService.test.ts`. `NothingUnusualService` is the impure
 * wrapper, tested separately below with fake repos (constructor-injected,
 * same pattern as `weekEarningsService.test.ts` — no `mock.module()` needed).
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  type NothingUnusualInput,
  NothingUnusualService,
  nothingUnusualForWeek,
  wasTimeEntryEdited,
} from '../../../../../src/domains/pay/services/nothingUnusualService';

function baseInput(
  over: Partial<NothingUnusualInput> = {}
): NothingUnusualInput {
  return {
    timesheetStatus: 'submitted',
    hasEditedEntry: false,
    hasAdHocOrOffPatternEntry: false,
    reimbursementsMinor: 0,
    lineArrangementIds: ['arr-1', 'arr-1'],
    grossMinor: 15_400,
    trailingGrossHistory: [15_400, 15_500, 15_300, 15_400],
    ...over,
  };
}

describe('nothingUnusualForWeek — pure predicate', () => {
  it('true when every criterion holds', () => {
    expect(nothingUnusualForWeek(baseInput())).toBe(true);
  });

  it('false on an open query', () => {
    expect(
      nothingUnusualForWeek(baseInput({ timesheetStatus: 'queried' }))
    ).toBe(false);
  });

  it('false when a time entry was edited after the fact', () => {
    expect(nothingUnusualForWeek(baseInput({ hasEditedEntry: true }))).toBe(
      false
    );
  });

  it('false on an ad-hoc or off-pattern shift', () => {
    expect(
      nothingUnusualForWeek(baseInput({ hasAdHocOrOffPatternEntry: true }))
    ).toBe(false);
  });

  it('false when any expense or reimbursement is attached', () => {
    expect(nothingUnusualForWeek(baseInput({ reimbursementsMinor: 500 }))).toBe(
      false
    );
  });

  it('false when an arrangement change took effect inside the week', () => {
    expect(
      nothingUnusualForWeek(
        baseInput({ lineArrangementIds: ['arr-1', 'arr-2'] })
      )
    ).toBe(false);
  });

  it('null arrangement ids on their own do not count as a split', () => {
    expect(
      nothingUnusualForWeek(baseInput({ lineArrangementIds: [null, null] }))
    ).toBe(true);
  });

  it('true when there are fewer than 4 trailing weeks — no baseline to test against', () => {
    expect(
      nothingUnusualForWeek(
        baseInput({ grossMinor: 999_999, trailingGrossHistory: [15_400] })
      )
    ).toBe(true);
  });

  it('false when the gross is quietly double the trailing median', () => {
    expect(
      nothingUnusualForWeek(
        baseInput({
          grossMinor: 30_800,
          trailingGrossHistory: [15_400, 15_400, 15_400, 15_400],
        })
      )
    ).toBe(false);
  });

  it('true exactly at the edge of the 20% band (inclusive)', () => {
    // median 15,400 · band ±3,080 · 18,480 is exactly the ceiling
    expect(
      nothingUnusualForWeek(
        baseInput({
          grossMinor: 18_480,
          trailingGrossHistory: [15_400, 15_400, 15_400, 15_400],
        })
      )
    ).toBe(true);
  });

  it('false just outside the 20% band', () => {
    expect(
      nothingUnusualForWeek(
        baseInput({
          grossMinor: 18_481,
          trailingGrossHistory: [15_400, 15_400, 15_400, 15_400],
        })
      )
    ).toBe(false);
  });

  it('a zero-gross week only matches a zero-gross median', () => {
    expect(
      nothingUnusualForWeek(
        baseInput({ grossMinor: 100, trailingGrossHistory: [0, 0, 0, 0] })
      )
    ).toBe(false);
    expect(
      nothingUnusualForWeek(
        baseInput({ grossMinor: 0, trailingGrossHistory: [0, 0, 0, 0] })
      )
    ).toBe(true);
  });
});

function timeEntry(over: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'te-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    carer_display_name: 'Nia Rowe',
    household_member_id: 'member-1',
    shift_id: 'shift-1',
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T16:00:00.000Z',
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: '2026-08-03',
    timezone: 'America/New_York',
    created_at: '2026-08-03T08:00:00.000Z',
    updated_at: '2026-08-03T16:00:00.000Z',
    ...over,
  };
}

describe('wasTimeEntryEdited', () => {
  it('false for a fresh clock-out — updated_at settles at clock-out', () => {
    expect(wasTimeEntryEdited(timeEntry())).toBe(false);
  });

  it('true when updated_at is well after the entry settled', () => {
    expect(
      wasTimeEntryEdited(timeEntry({ updated_at: '2026-08-04T09:00:00.000Z' }))
    ).toBe(true);
  });

  it('false within the one-minute settle slack', () => {
    expect(
      wasTimeEntryEdited(timeEntry({ updated_at: '2026-08-03T16:00:30.000Z' }))
    ).toBe(false);
  });

  it('false for a voided entry — voiding bumps updated_at but is not a correction', () => {
    expect(
      wasTimeEntryEdited(
        timeEntry({
          status: 'voided',
          updated_at: '2026-08-04T09:00:00.000Z',
        })
      )
    ).toBe(false);
  });

  it('false for a still-running entry (no clock_out_at)', () => {
    expect(
      wasTimeEntryEdited(
        timeEntry({
          clock_out_at: null,
          updated_at: '2026-08-04T09:00:00.000Z',
        })
      )
    ).toBe(false);
  });

  it('false for a week-boundary split fragment ending exactly at local midnight', () => {
    expect(
      wasTimeEntryEdited(
        timeEntry({
          clock_out_at: '2026-08-04T04:00:00.000Z', // 00:00 America/New_York (EDT, UTC-4)
          updated_at: '2026-08-05T09:00:00.000Z',
        })
      )
    ).toBe(false);
  });

  it('true for a retroactive entry born complete, settled at created_at not clock_out_at', () => {
    expect(
      wasTimeEntryEdited(
        timeEntry({
          created_at: '2026-08-03T20:00:00.000Z', // after clock_out_at — retro entry
          updated_at: '2026-08-04T20:01:00.000Z', // well after created_at settle
        })
      )
    ).toBe(true);
  });
});

function shift(over: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    child_ids: [],
    local_date: '2026-08-03',
    starts_at: '2026-08-03T12:00:00.000Z',
    ends_at: '2026-08-03T20:00:00.000Z',
    timezone: 'America/New_York',
    status: 'confirmed',
    source_pattern_id: 'pattern-1',
    cancellation_paid: false,
    ical_uid: 'uid-1',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  } as Shift;
}

function makeTimeEntryRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForCarerWeek: mock(async () => [timeEntry()]),
    ...overrides,
  };
}

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByIds: mock(async () => [shift()]),
    ...overrides,
  };
}

function makeTimesheetRepo(overrides: Record<string, unknown> = {}): any {
  return {
    recentApprovedGross: mock(async () => [15_400, 15_400, 15_400, 15_400]),
    ...overrides,
  };
}

const okEarnings = {
  status: 'ok' as const,
  week_start: '2026-08-03',
  currency: 'USD',
  lines: [
    {
      kind: 'regular',
      minutes: 2400,
      rate_minor: 2800,
      multiplier: null,
      amount_minor: 15_400,
      from_date: '2026-08-03',
      to_date: '2026-08-09',
      arrangement_id: 'arr-1',
    },
  ],
  gross_minor: 15_400,
  reimbursements_minor: 0,
  worked_minutes: 2400,
  payable_minutes: 2400,
  guaranteed_minutes_per_week: null,
};

describe('NothingUnusualService.computeForWeek — impure wrapper', () => {
  it('wires the fetched facts through to the pure predicate: true on a quiet week', async () => {
    const svc = new NothingUnusualService(
      makeTimeEntryRepo(),
      makeShiftRepo(),
      makeTimesheetRepo()
    );
    expect(
      await svc.computeForWeek(
        'h1',
        'carer-1',
        '2026-08-03',
        'submitted',
        okEarnings
      )
    ).toBe(true);
  });

  it('false when a priced entry has no shift at all (ad hoc)', async () => {
    const svc = new NothingUnusualService(
      makeTimeEntryRepo({
        listForCarerWeek: mock(async () => [timeEntry({ shift_id: null })]),
      }),
      makeShiftRepo({ findByIds: mock(async () => []) }),
      makeTimesheetRepo()
    );
    expect(
      await svc.computeForWeek(
        'h1',
        'carer-1',
        '2026-08-03',
        'submitted',
        okEarnings
      )
    ).toBe(false);
  });

  it('false when a priced shift is not from the household pattern', async () => {
    const svc = new NothingUnusualService(
      makeTimeEntryRepo(),
      makeShiftRepo({
        findByIds: mock(async () => [shift({ source_pattern_id: null })]),
      }),
      makeTimesheetRepo()
    );
    expect(
      await svc.computeForWeek(
        'h1',
        'carer-1',
        '2026-08-03',
        'submitted',
        okEarnings
      )
    ).toBe(false);
  });

  it('false when the week is queried', async () => {
    const svc = new NothingUnusualService(
      makeTimeEntryRepo(),
      makeShiftRepo(),
      makeTimesheetRepo()
    );
    expect(
      await svc.computeForWeek(
        'h1',
        'carer-1',
        '2026-08-03',
        'queried',
        okEarnings
      )
    ).toBe(false);
  });

  it('never fetches shifts when no priced entry carries a shift_id', async () => {
    const findByIds = mock(async () => []);
    const svc = new NothingUnusualService(
      makeTimeEntryRepo({
        listForCarerWeek: mock(async () => []),
      }),
      makeShiftRepo({ findByIds }),
      makeTimesheetRepo()
    );
    await svc.computeForWeek(
      'h1',
      'carer-1',
      '2026-08-03',
      'submitted',
      okEarnings
    );
    expect(findByIds).not.toHaveBeenCalled();
  });

  it('excludes voided entries from every check', async () => {
    const svc = new NothingUnusualService(
      makeTimeEntryRepo({
        listForCarerWeek: mock(async () => [
          timeEntry({
            status: 'voided',
            shift_id: null,
            updated_at: '2026-08-10T00:00:00.000Z',
          }),
        ]),
      }),
      makeShiftRepo({ findByIds: mock(async () => []) }),
      makeTimesheetRepo()
    );
    expect(
      await svc.computeForWeek(
        'h1',
        'carer-1',
        '2026-08-03',
        'submitted',
        okEarnings
      )
    ).toBe(true);
  });
});

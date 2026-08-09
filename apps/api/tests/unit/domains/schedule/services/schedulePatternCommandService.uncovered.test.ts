/**
 * Materialisation caller runs uncovered detection for touched dates in the 7-day window.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SchedulePattern } from '../../../../../src/domains/schedule/types';

const NOW = new Date('2026-06-01T12:00:00.000Z');

const pattern: SchedulePattern = {
  id: 'pattern-1',
  household_id: 'household-1',
  carer_id: 'carer-1',
  timezone: 'Europe/London',
  status: 'accepted',
  rrule: 'FREQ=WEEKLY;BYDAY=WE',
  dtstart: '2026-06-04',
  until: null,
  exdates: [],
  pause_ranges: [],
  note: null,
  decline_message: null,
  ical_uid: 'pattern-ical-uid',
  sequence: 0,
  created_by: 'parent-1',
  sent_at: null,
  responded_at: null,
  created_at: 't',
  updated_at: 't',
};

let SchedulePatternCommandService: typeof import('../../../../../src/domains/schedule/services/schedulePatternCommandService').SchedulePatternCommandService;
let detectUncoveredCareBestEffort: ReturnType<typeof mock>;

beforeAll(async () => {
  detectUncoveredCareBestEffort = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate: mock(async () => []),
      detectUncoveredCareBestEffort,
    })
  );

  ({ SchedulePatternCommandService } = await import(
    '../../../../../src/domains/schedule/services/schedulePatternCommandService'
  ));
});

beforeEach(() => {
  detectUncoveredCareBestEffort.mockClear();
});

function makeSvc(materialiseResult: { touchedDates: string[] }) {
  return new SchedulePatternCommandService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      getDaysForPattern: mock(async () => [
        {
          id: 'day-1',
          pattern_id: 'pattern-1',
          weekday: 3,
          start_time: '09:00:00',
          end_time: '17:00:00',
          children: [],
        },
      ]),
    } as never,
    {
      materialise: mock(async () => ({
        created: 1,
        updated: 0,
        deleted: 0,
        cancelled: 0,
        conflicts: [],
        touchedDates: materialiseResult.touchedDates,
      })),
    } as never,
    {} as never
  );
}

describe('SchedulePatternCommandService.runMaterialisation — uncovered detection', () => {
  it('detects only touched dates inside the next 7 local days', async () => {
    const svc = makeSvc({
      touchedDates: ['2026-06-04', '2026-06-20'],
    });

    await svc.materialiseForHorizon(pattern, 28, NOW);

    expect(detectUncoveredCareBestEffort).toHaveBeenCalledTimes(1);
    expect(detectUncoveredCareBestEffort).toHaveBeenCalledWith({
      householdId: 'household-1',
      localDate: '2026-06-04',
      cause: 'nothingScheduled',
    });
  });
});

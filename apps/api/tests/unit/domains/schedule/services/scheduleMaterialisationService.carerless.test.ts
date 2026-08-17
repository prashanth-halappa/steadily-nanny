/**
 * Belt and braces for the deleted-carer ghost shift.
 *
 * `schedule_patterns.carer_id` is `on delete set null` (014), so a nanny
 * deleting her account leaves an `accepted` pattern with no carer — and
 * `scheduleHorizonJob` -> `materialiseForHorizon` keeps expanding it to the
 * horizon forever. `userService.deleteUser` now ends those patterns, but a
 * pattern can lose its carer by other routes too (a dashboard delete, a
 * partial teardown), and a shift nobody is assigned to must never be born
 * `confirmed` — `confirmed` is what tells the parent somebody is coming.
 *
 * `pending` is the right status for one: it shows on the schedule
 * (`SCHEDULED_SHIFT_STATUSES`) but is not cover (`COVERING_SHIFT_STATUSES`),
 * so the uncovered alarm still rings.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { NewShiftData } from '../../../../../src/domains/schedule/repositories/scheduleShiftRepository';
import type { ExpandedOccurrence } from '../../../../../src/domains/schedule/services/recurrenceExpander';
import type {
  ConflictEventRepository,
  MaterialisationShiftRepository,
  PatternForMaterialisation,
  TimeEntryExistenceRepository,
} from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';
import { ScheduleMaterialisationService } from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';

const NOW = new Date('2026-06-01T00:00:00.000Z');

const pattern: PatternForMaterialisation = {
  id: 'pattern-1',
  householdId: 'household-1',
  carerId: 'carer-1',
  timezone: 'Europe/London',
  icalUid: 'pattern-ical-uid',
  note: 'The usual week',
};

function occurrence(): ExpandedOccurrence {
  return {
    localDate: '2026-06-04',
    weekday: 4,
    startsAt: '2026-06-04T07:00:00.000Z',
    startTime: '07:00:00',
    endsAt: '2026-06-04T16:00:00.000Z',
    children: [],
  };
}

function baseShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: 'household-1',
    carer_id: 'carer-1',
    starts_at: '2026-06-04T07:00:00.000Z',
    ends_at: '2026-06-04T16:00:00.000Z',
    timezone: 'Europe/London',
    local_date: '2026-06-04',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: 'pattern-1',
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'pattern-ical-uid::2026-06-04',
    sequence: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRepo(): MaterialisationShiftRepository {
  return {
    findActiveByPattern: mock(async () => []),
    findRecurringInWindow: mock(async () => null),
    shiftIdsWithChangeRequests: mock(async () => new Set<string>()),
    create: mock(async () => baseShift()),
    update: mock(async () => baseShift()),
    createMany: mock(async (rows: NewShiftData[]) =>
      rows.map((row, index) =>
        baseShift({ id: `shift-${index + 1}`, ical_uid: row.ical_uid })
      )
    ),
    updateMany: mock(async () => undefined),
    deleteMany: mock(async () => undefined),
    replaceChildrenMany: mock(async () => undefined),
  };
}

function makeService(repo: MaterialisationShiftRepository) {
  const timeEntryRepo: TimeEntryExistenceRepository = {
    shiftIdsWithTimeEntries: mock(async () => new Set<string>()),
  };
  const eventRepo: ConflictEventRepository = {
    listEventKeysForDate: mock(async () => new Set<string>()),
    insertMany: mock(async () => undefined),
  };
  return new ScheduleMaterialisationService(repo, timeEntryRepo, eventRepo);
}

describe('ScheduleMaterialisationService — a pattern with no carer', () => {
  it('materialises pending, never confirmed', async () => {
    const repo = makeRepo();

    await makeService(repo).materialise(
      { ...pattern, carerId: null },
      [occurrence()],
      NOW
    );

    expect(repo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ carer_id: null, status: 'pending' }),
    ]);
  });

  it('still materialises confirmed when a carer is assigned', async () => {
    const repo = makeRepo();

    await makeService(repo).materialise(pattern, [occurrence()], NOW);

    expect(repo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ carer_id: 'carer-1', status: 'confirmed' }),
    ]);
  });
});

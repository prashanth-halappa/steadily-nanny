/**
 * Supersede-on-accept, and the ended-pattern shift leak (WS-A).
 *
 * A household could hold several SIMULTANEOUSLY-`accepted` patterns for the
 * same (household, carer): `respond`'s accept branch flipped one pattern to
 * `accepted` and materialised it, but never ended the prior one. Each
 * accepted pattern then materialised the same week independently — its
 * dedupe (`findByPatternAndDate`) is scoped to `source_pattern_id`, so it is
 * blind to another pattern's shift at the identical instant — and the family
 * got byte-identical duplicate shifts. Migration 014's header always said
 * `ended` meant "superseded or past its `until` date"; only the second half
 * was ever implemented.
 *
 * Constructor-injected fakes throughout, never `mock.module()` — same style
 * as `schedulePatternCommandService.test.ts`.
 *
 * @module tests/unit/domains/schedule/services/schedulePatternSupersede
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { MaterialisationShiftRepository } from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';
import { ScheduleMaterialisationService } from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';
import { SchedulePatternCommandService } from '../../../../../src/domains/schedule/services/schedulePatternCommandService';

/** Fixed clock — "future"/"past" below are relative to this instant, never the wall clock. */
const NOW = new Date('2026-08-03T12:00:00.000Z');
const FUTURE_START = '2026-09-10T07:00:00.000Z';
const PAST_START = '2026-07-02T07:00:00.000Z';

function patternFor(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'p1',
    household_id: 'h1',
    carer_id: 'carer-1',
    status: 'draft',
    rrule: 'FREQ=WEEKLY;INTERVAL=1',
    dtstart: '2026-02-02',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: 'The usual week',
    created_by: 'u1',
    sent_at: null,
    responded_at: null,
    ical_uid: 'pattern-uid',
    sequence: 0,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function shiftFor(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-future',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: FUTURE_START,
    ends_at: '2026-09-10T16:00:00.000Z',
    timezone: 'Europe/London',
    local_date: '2026-09-10',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: 'p0',
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'prior-uid::2026-09-10',
    sequence: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const defaultDays = [
  {
    id: 'd1',
    pattern_id: 'p1',
    weekday: 4,
    start_time: '08:00',
    end_time: '17:00',
    children: [],
  },
];

function makePatternRepo(
  accepted: Record<string, unknown>[] = [],
  overrides: Record<string, unknown> = {}
): any {
  return {
    create: mock(async () => patternFor()),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...patternFor(),
      id,
      ...data,
    })),
    // Behaves like the real query: scoped to ONE (household, carer).
    listAcceptedByHouseholdAndCarer: mock(
      async (householdId: string, carerId: string | null) =>
        accepted.filter(
          p => p.household_id === householdId && p.carer_id === carerId
        )
    ),
    ...overrides,
  };
}

function makeMemberRepo(role: string | null = 'nanny'): any {
  return {
    findActiveMembership: mock(async () =>
      role ? { id: 'm1', household_id: 'h1', user_id: 'u1', role } : null
    ),
  };
}

function makeQueries(pattern: Record<string, unknown> = patternFor()): any {
  return {
    getOwned: mock(async () => pattern),
    getWithDays: mock(async () => ({ ...pattern, days: defaultDays })),
    getDaysForPattern: mock(async () => defaultDays),
  };
}

function makeShiftRepo(
  shiftsByPattern: Record<string, Shift[]> = {},
  overrides: Partial<MaterialisationShiftRepository> = {}
): MaterialisationShiftRepository {
  return {
    findByPatternAndDate: mock(async () => null),
    findActiveByPattern: mock(
      async (patternId: string) => shiftsByPattern[patternId] ?? []
    ),
    findRecurringInWindow: mock(async () => null),
    hasChangeRequests: mock(async () => false),
    create: mock(async () => shiftFor({ id: 'shift-new' })),
    update: mock(async (id: string) => shiftFor({ id })),
    delete: mock(async () => undefined),
    replaceChildren: mock(async () => undefined),
    ...overrides,
  };
}

function makeMaterialisation(
  shiftRepo: MaterialisationShiftRepository,
  hasTimeEntries = false
): ScheduleMaterialisationService {
  return new ScheduleMaterialisationService(
    shiftRepo,
    { hasTimeEntries: mock(async () => hasTimeEntries) },
    {
      listEventKeysForDate: mock(async () => new Set<string>()),
      insertMany: mock(async () => undefined),
    }
  );
}

function makeService(
  patternRepo: any,
  queries: any,
  materialisation: ScheduleMaterialisationService,
  role = 'nanny'
) {
  const empty: any = {};
  return new SchedulePatternCommandService(
    patternRepo,
    empty,
    empty,
    makeMemberRepo(role),
    empty,
    queries,
    materialisation
  );
}

describe('respond(accepted) supersedes prior accepted patterns', () => {
  it('ends every other accepted pattern for the same carer and cancels only their FUTURE system-generated shifts', async () => {
    const prior = patternFor({ id: 'p0', status: 'accepted' });
    const shiftRepo = makeShiftRepo({
      p0: [
        shiftFor({ id: 'shift-future' }),
        shiftFor({ id: 'shift-past', starts_at: PAST_START }),
      ],
    });
    const patternRepo = makePatternRepo([prior]);
    const svc = makeService(
      patternRepo,
      makeQueries(patternFor({ status: 'pending' })),
      makeMaterialisation(shiftRepo)
    );

    await svc.respond('carer-1', 'p1', { status: 'accepted' }, NOW);

    expect(patternRepo.listAcceptedByHouseholdAndCarer).toHaveBeenCalledWith(
      'h1',
      'carer-1'
    );
    expect(patternRepo.update).toHaveBeenCalledWith('p0', { status: 'ended' });

    const touchedShiftIds = (
      shiftRepo.update as ReturnType<typeof mock>
    ).mock.calls.map((call: unknown[]) => call[0]);
    expect(touchedShiftIds).toContain('shift-future');
    expect(touchedShiftIds).not.toContain('shift-past');
    expect(shiftRepo.update).toHaveBeenCalledWith(
      'shift-future',
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  it('never touches an accepted pattern belonging to a DIFFERENT carer in the same household', async () => {
    const otherCarers = patternFor({
      id: 'p-other',
      status: 'accepted',
      carer_id: 'carer-2',
    });
    const shiftRepo = makeShiftRepo({
      'p-other': [shiftFor({ id: 'shift-other-carer' })],
    });
    const patternRepo = makePatternRepo([otherCarers]);
    const svc = makeService(
      patternRepo,
      makeQueries(patternFor({ status: 'pending' })),
      makeMaterialisation(shiftRepo)
    );

    await svc.respond('carer-1', 'p1', { status: 'accepted' }, NOW);

    const endedIds = patternRepo.update.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(endedIds).not.toContain('p-other');
    const touchedShiftIds = (
      shiftRepo.update as ReturnType<typeof mock>
    ).mock.calls.map((call: unknown[]) => call[0]);
    expect(touchedShiftIds).not.toContain('shift-other-carer');
  });

  it('does not end the pattern being accepted itself', async () => {
    const self = patternFor({ id: 'p1', status: 'accepted' });
    const patternRepo = makePatternRepo([self]);
    const svc = makeService(
      patternRepo,
      makeQueries(patternFor({ status: 'pending' })),
      makeMaterialisation(makeShiftRepo())
    );

    await svc.respond('carer-1', 'p1', { status: 'accepted' }, NOW);

    expect(patternRepo.update).not.toHaveBeenCalledWith('p1', {
      status: 'ended',
    });
  });

  it('declining supersedes nothing', async () => {
    const prior = patternFor({ id: 'p0', status: 'accepted' });
    const patternRepo = makePatternRepo([prior]);
    const svc = makeService(
      patternRepo,
      makeQueries(patternFor({ status: 'pending' })),
      makeMaterialisation(makeShiftRepo())
    );

    await svc.respond('carer-1', 'p1', { status: 'declined' }, NOW);

    expect(patternRepo.listAcceptedByHouseholdAndCarer).not.toHaveBeenCalled();
  });
});

describe('every path that ends a pattern cleans up its future shifts', () => {
  it('amend with `until` in the past cancels the pattern future shifts', async () => {
    const accepted = patternFor({ status: 'accepted', until: null });
    const shiftRepo = makeShiftRepo({
      p1: [
        shiftFor({ id: 'shift-future', source_pattern_id: 'p1' }),
        shiftFor({
          id: 'shift-past',
          source_pattern_id: 'p1',
          starts_at: PAST_START,
        }),
      ],
    });
    const patternRepo = makePatternRepo();
    const svc = makeService(
      patternRepo,
      makeQueries(accepted),
      makeMaterialisation(shiftRepo),
      'owner'
    );

    await svc.amend('u1', 'p1', { until: '2026-07-01' }, NOW);

    expect(patternRepo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ status: 'ended', until: '2026-07-01' })
    );
    expect(shiftRepo.update).toHaveBeenCalledWith(
      'shift-future',
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  it('materialiseForHorizon ending a past-due pattern cancels its future shifts', async () => {
    const accepted = patternFor({ status: 'accepted', until: '2026-07-01' });
    const shiftRepo = makeShiftRepo({
      p1: [shiftFor({ id: 'shift-future', source_pattern_id: 'p1' })],
    });
    const patternRepo = makePatternRepo();
    const svc = makeService(
      patternRepo,
      makeQueries(accepted),
      makeMaterialisation(shiftRepo),
      'owner'
    );

    await svc.materialiseForHorizon(accepted, 30, NOW);

    expect(patternRepo.update).toHaveBeenCalledWith('p1', {
      status: 'ended',
    });
    expect(shiftRepo.update).toHaveBeenCalledWith(
      'shift-future',
      expect.objectContaining({ status: 'cancelled' })
    );
  });
});

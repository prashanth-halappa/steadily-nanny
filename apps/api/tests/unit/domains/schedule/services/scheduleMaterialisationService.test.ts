/**
 * Idempotent re-materialisation — one test per branch of the existing-shift
 * policy table in the wave-2 spec. Written BEFORE the implementation exists
 * (TDD red-first). Uses constructor-injected fakes (plain objects
 * implementing `MaterialisationShiftRepository`), never `mock.module()`, per
 * the team's stated preference.
 *
 * @module tests/unit/domains/schedule/services/scheduleMaterialisationService
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { ExpandedOccurrence } from '../../../../../src/domains/schedule/services/recurrenceExpander';
import type {
  MaterialisationShiftRepository,
  PatternForMaterialisation,
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

function occurrence(
  overrides: Partial<ExpandedOccurrence> = {}
): ExpandedOccurrence {
  return {
    localDate: '2026-06-04',
    weekday: 4,
    startsAt: '2026-06-04T07:00:00.000Z',
    endsAt: '2026-06-04T16:00:00.000Z',
    children: [],
    ...overrides,
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

function makeRepo(
  overrides: Partial<MaterialisationShiftRepository> = {}
): MaterialisationShiftRepository {
  return {
    findByPatternAndDate: mock(async () => null),
    findActiveByPattern: mock(async () => []),
    hasChangeRequests: mock(async () => false),
    create: mock(async () => baseShift()),
    update: mock(async () => baseShift()),
    delete: mock(async () => undefined),
    replaceChildren: mock(async () => undefined),
    insertEvent: mock(async () => undefined),
    ...overrides,
  };
}

describe('ScheduleMaterialisationService — new occurrence', () => {
  it('creates a confirmed, system_generated shift with a deterministic ical_uid, and replaces its children', async () => {
    const repo = makeRepo();
    const svc = new ScheduleMaterialisationService(repo);

    const occ = occurrence({
      children: [{ childId: 'child-1', startsAt: null, endsAt: null }],
    });
    const result = await svc.materialise(pattern, [occ], NOW);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'household-1',
        carer_id: 'carer-1',
        starts_at: occ.startsAt,
        ends_at: occ.endsAt,
        timezone: 'Europe/London',
        status: 'confirmed',
        origin: 'system_generated',
        source_pattern_id: 'pattern-1',
        ical_uid: 'pattern-ical-uid::2026-06-04',
        note: 'The usual week',
      })
    );
    expect(repo.replaceChildren).toHaveBeenCalledWith('shift-1', [
      { child_id: 'child-1', starts_at: null, ends_at: null },
    ]);
    expect(result).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    });
  });
});

describe('ScheduleMaterialisationService — existing shift, untouched, draft/pending', () => {
  it('overwrites times, children, and note; status is left alone', async () => {
    const existing = baseShift({ status: 'draft', note: 'old note' });
    const repo = makeRepo({
      findByPatternAndDate: mock(async () => existing),
    });
    const svc = new ScheduleMaterialisationService(repo);

    const occ = occurrence({
      startsAt: '2026-06-04T07:30:00.000Z',
      endsAt: '2026-06-04T16:30:00.000Z',
      children: [{ childId: 'child-2', startsAt: null, endsAt: null }],
    });
    const result = await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({
        starts_at: occ.startsAt,
        ends_at: occ.endsAt,
        note: 'The usual week',
        status: 'draft',
      })
    );
    expect(repo.replaceChildren).toHaveBeenCalledWith('shift-1', [
      { child_id: 'child-2', starts_at: null, ends_at: null },
    ]);
    expect(result.updated).toBe(1);
    expect(result.conflicts).toEqual([]);
  });
});

describe('ScheduleMaterialisationService — existing confirmed, untouched', () => {
  it('overwrites in place and keeps status confirmed when times did not move', async () => {
    const existing = baseShift({ status: 'confirmed' });
    const repo = makeRepo({
      findByPatternAndDate: mock(async () => existing),
    });
    const svc = new ScheduleMaterialisationService(repo);

    // Same start/end as `existing` — nothing moved.
    const occ = occurrence({
      startsAt: existing.starts_at,
      endsAt: existing.ends_at,
    });
    await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({ status: 'confirmed' })
    );
  });

  it('reverts to pending (carer must re-accept) when times moved', async () => {
    const existing = baseShift({ status: 'confirmed' });
    const repo = makeRepo({
      findByPatternAndDate: mock(async () => existing),
    });
    const svc = new ScheduleMaterialisationService(repo);

    const occ = occurrence({
      startsAt: '2026-06-04T08:00:00.000Z', // moved from 07:00Z
      endsAt: existing.ends_at,
    });
    await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({ status: 'pending', starts_at: occ.startsAt })
    );
  });
});

describe('ScheduleMaterialisationService — manually touched shift (origin or change requests)', () => {
  it('preserves a shift with a non-system origin: no update, no delete, emits a pattern_conflict event and a warning', async () => {
    const existing = baseShift({ origin: 'parent_proposed' });
    const repo = makeRepo({
      findByPatternAndDate: mock(async () => existing),
    });
    const svc = new ScheduleMaterialisationService(repo);

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'household-1',
        shift_id: 'shift-1',
        local_date: '2026-06-04',
        event_type: 'pattern_conflict',
      })
    );
    expect(result.conflicts).toEqual([
      {
        shiftId: 'shift-1',
        localDate: '2026-06-04',
        reason: 'manually_edited',
      },
    ]);
    expect(result.updated).toBe(0);
  });

  it('preserves a system_generated shift that has any shift_change_requests row, even with no other edits', async () => {
    const existing = baseShift({ origin: 'system_generated' });
    const repo = makeRepo({
      findByPatternAndDate: mock(async () => existing),
      hasChangeRequests: mock(async () => true),
    });
    const svc = new ScheduleMaterialisationService(repo);

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.reason).toBe('manually_edited');
  });
});

describe('ScheduleMaterialisationService — completed/cancelled shifts are NEVER touched', () => {
  it('does not update, delete, or emit events for a completed shift, even if its times moved', async () => {
    const existing = baseShift({ status: 'completed' });
    const repo = makeRepo({
      findByPatternAndDate: mock(async () => existing),
    });
    const svc = new ScheduleMaterialisationService(repo);

    const occ = occurrence({ startsAt: '2026-06-04T09:00:00.000Z' });
    const result = await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.insertEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    });
  });

  it('does not touch an already-cancelled shift', async () => {
    const existing = baseShift({ status: 'cancelled' });
    const repo = makeRepo({
      findByPatternAndDate: mock(async () => existing),
    });
    const svc = new ScheduleMaterialisationService(repo);

    await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

describe('ScheduleMaterialisationService — occurrences no longer produced by the RRULE', () => {
  it('hard-deletes a future, untouched, system_generated shift that the pattern no longer produces', async () => {
    const orphan = baseShift({
      id: 'shift-orphan',
      local_date: '2026-07-01', // not in the produced set below
      starts_at: '2026-07-01T07:00:00.000Z',
      status: 'confirmed',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [orphan]),
    });
    const svc = new ScheduleMaterialisationService(repo);

    // Only 2026-06-04 is produced this run — the orphan's date is not.
    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.delete).toHaveBeenCalledWith('shift-orphan');
    expect(repo.update).not.toHaveBeenCalled();
    expect(result.deleted).toBe(1);
  });

  it('cancels (does not delete) a no-longer-produced shift that is in the past', async () => {
    const orphan = baseShift({
      id: 'shift-past-orphan',
      local_date: '2026-05-01',
      starts_at: '2026-05-01T07:00:00.000Z', // before NOW (2026-06-01)
      status: 'confirmed',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [orphan]),
    });
    const svc = new ScheduleMaterialisationService(repo);

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(
      'shift-past-orphan',
      expect.objectContaining({
        status: 'cancelled',
        reason: 'pattern_changed',
      })
    );
    expect(result.cancelled).toBe(1);
  });

  it('cancels rather than deletes a future no-longer-produced shift that was manually touched, and warns', async () => {
    const orphan = baseShift({
      id: 'shift-touched-orphan',
      local_date: '2026-07-01',
      starts_at: '2026-07-01T07:00:00.000Z',
      status: 'confirmed',
      origin: 'nanny_countered',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [orphan]),
    });
    const svc = new ScheduleMaterialisationService(repo);

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(
      'shift-touched-orphan',
      expect.objectContaining({
        status: 'cancelled',
        reason: 'pattern_changed',
      })
    );
    expect(result.cancelled).toBe(1);
    expect(result.conflicts).toEqual([
      {
        shiftId: 'shift-touched-orphan',
        localDate: '2026-07-01',
        reason: 'manually_edited_now_cancelled',
      },
    ]);
  });

  it('never touches an orphaned shift that is already completed or cancelled', async () => {
    const orphanCompleted = baseShift({
      id: 'shift-orphan-completed',
      local_date: '2026-05-01',
      status: 'completed',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [orphanCompleted]),
    });
    const svc = new ScheduleMaterialisationService(repo);

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
    expect(result.cancelled).toBe(0);
  });
});

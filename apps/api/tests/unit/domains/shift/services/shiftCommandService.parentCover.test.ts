/**
 * Parent-cover shift writes — role gate, kind/origin/status, child validation.
 */
import { describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import { ShiftCommandService } from '../../../../../src/domains/shift/services/shiftCommandService';
import { ValidationError } from '../../../../../src/errors';

const household = {
  id: 'h1',
  name: 'Smiths',
  timezone: 'Europe/London',
};

const parentCoverShift = {
  id: 'pc1',
  household_id: 'h1',
  carer_id: null,
  starts_at: '2026-08-03T09:00:00.000Z',
  ends_at: '2026-08-03T12:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2026-08-03',
  kind: 'parent_cover' as const,
  status: 'confirmed' as const,
  source_pattern_id: null,
  origin: 'parent_cover' as const,
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'uid-pc1',
  sequence: 0,
  created_by: 'parent-1',
  created_at: 't',
  updated_at: 't',
  shift_children: [],
};

const recurringShift = {
  ...parentCoverShift,
  id: 's1',
  kind: 'recurring' as const,
  origin: 'system_generated' as const,
  carer_id: 'carer-1',
};

function makeSvc(overrides: Record<string, unknown> = {}) {
  const insertChildren = mock(async () => undefined);
  const createShift = mock(async () => parentCoverShift);
  const deleteShift = mock(async () => undefined);
  return {
    svc: new ShiftCommandService(
      {
        findParentCoverInWindow: mock(async () => null),
        createShift,
        insertChildren,
        delete: deleteShift,
        ...((overrides.shiftRepo as object) ?? {}),
      } as never,
      {
        findActiveMembership: mock(async () => ({
          id: 'm1',
          household_id: 'h1',
          user_id: 'parent-1',
          role: 'parent',
        })),
        ...((overrides.memberRepo as object) ?? {}),
      } as never,
      {
        getOwned: mock(async () => parentCoverShift),
        ...((overrides.queries as object) ?? {}),
      } as never,
      { insertMany: mock(async () => []) } as never,
      {
        getOwned: mock(async () => ({ id: 'child-1', household_id: 'h1' })),
        ...((overrides.children as object) ?? {}),
      } as never,
      {
        findById: mock(async () => household),
        ...((overrides.householdRepo as object) ?? {}),
      } as never
    ),
    createShift,
    insertChildren,
    deleteShift,
  };
}

describe('ShiftCommandService.createParentCover', () => {
  it('rejects a nanny caller', async () => {
    const { svc } = makeSvc({
      memberRepo: {
        findActiveMembership: mock(async () => ({
          id: 'm2',
          household_id: 'h1',
          user_id: 'carer-1',
          role: 'nanny',
        })),
      },
    });

    await expect(
      svc.createParentCover('carer-1', 'h1', {
        starts_at: '2026-08-03T09:00:00.000Z',
        ends_at: '2026-08-03T12:00:00.000Z',
        child_id: 'child-1',
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('writes parent_cover kind, origin, confirmed status, and null carer', async () => {
    const { svc, createShift, insertChildren } = makeSvc();

    await svc.createParentCover('parent-1', 'h1', {
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T12:00:00.000Z',
      child_id: 'child-1',
    });

    expect(createShift).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        carer_id: null,
        kind: 'parent_cover',
        origin: 'parent_cover',
        status: 'confirmed',
      })
    );
    expect(insertChildren).toHaveBeenCalledWith('pc1', ['child-1']);
  });

  it('validates the child belongs to the household', async () => {
    const children = {
      getOwned: mock(async () => {
        const { ChildNotFoundError } = await import(
          '../../../../../src/domains/child/errors/childErrors'
        );
        throw new ChildNotFoundError('child-1');
      }),
    };
    const { svc } = makeSvc({ children });

    await expect(
      svc.createParentCover('parent-1', 'h1', {
        starts_at: '2026-08-03T09:00:00.000Z',
        ends_at: '2026-08-03T12:00:00.000Z',
        child_id: 'child-1',
      })
    ).rejects.toMatchObject({ name: 'ChildNotFoundError' });
  });
});

describe('ShiftCommandService.removeParentCover', () => {
  it('refuses a non-parent_cover shift', async () => {
    const { svc } = makeSvc({
      queries: { getOwned: mock(async () => recurringShift) },
    });

    await expect(
      svc.removeParentCover('parent-1', 's1')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('hard-deletes a parent_cover shift', async () => {
    const { svc, deleteShift } = makeSvc();

    await svc.removeParentCover('parent-1', 'pc1');

    expect(deleteShift).toHaveBeenCalledWith('pc1');
  });
});

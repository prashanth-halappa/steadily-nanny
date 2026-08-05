/**
 * handoff_note_added push — notify the other party when a note is created.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { HouseholdMember } from '../../../../../src/domains/household/types';

let HandoffCommandService: typeof import('../../../../../src/domains/handoff/services/handoffCommandService').HandoffCommandService;
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser,
    notifyHouseholdParents,
  }));

  ({ HandoffCommandService } = await import(
    '../../../../../src/domains/handoff/services/handoffCommandService'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
});

function membership(role: HouseholdMember['role'], userId: string) {
  return {
    id: `m-${userId}`,
    household_id: 'h1',
    user_id: userId,
    role,
  };
}

function makeRepo() {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      id: 'n-new',
      created_at: 't',
      updated_at: 't',
      moment_saved_at: null,
      body: null,
      ...data,
    })),
  };
}

describe('HandoffCommandService.create — handoff_note_added', () => {
  it('notifies parents when the author is the nanny', async () => {
    const svc = new HandoffCommandService(
      makeRepo() as never,
      {
        getMembership: mock(async () => membership('nanny', 'carer-1')),
      } as never,
      { getOwned: mock() } as never,
      { listActiveByHousehold: mock(async () => []) } as never
    );

    await svc.create('carer-1', 'h1', {
      local_date: '2026-08-02',
      phase: 'evening',
      chips: ['ate well'],
    });

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        body: 'New evening handoff note from your nanny.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.HANDOFF_NOTE_ADDED,
          householdId: 'h1',
        },
      })
    );
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('notifies the carer when the author is a parent', async () => {
    const memberRepo = {
      listActiveByHousehold: mock(async () => [
        membership('nanny', 'carer-1'),
        membership('parent', 'parent-1'),
      ]),
    };
    const svc = new HandoffCommandService(
      makeRepo() as never,
      {
        getMembership: mock(async () => membership('parent', 'parent-1')),
      } as never,
      { getOwned: mock() } as never,
      memberRepo as never
    );

    await svc.create('parent-1', 'h1', {
      local_date: '2026-08-02',
      phase: 'morning',
      chips: ['slept well'],
    });

    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        body: 'New morning handoff note from a parent.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.HANDOFF_NOTE_ADDED,
          householdId: 'h1',
        },
      })
    );
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('push failure does not fail create', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('expo down');
    });
    const svc = new HandoffCommandService(
      makeRepo() as never,
      {
        getMembership: mock(async () => membership('nanny', 'carer-1')),
      } as never,
      { getOwned: mock() } as never,
      { listActiveByHousehold: mock(async () => []) } as never
    );

    await expect(
      svc.create('carer-1', 'h1', {
        local_date: '2026-08-02',
        phase: 'morning',
        chips: [],
      })
    ).resolves.toMatchObject({ id: 'n-new' });
  });
});

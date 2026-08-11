import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { PayArrangementNotFoundError } from '../../../../../src/domains/pay/errors/payErrors';
import { PayArrangementAckService } from '../../../../../src/domains/pay/services/payArrangementAckService';

const HOUSEHOLD_ID = 'h1';
const CARER_ID = 'carer-1';
const ARRANGEMENT_ID = 'pa-1';

const ARRANGEMENT = {
  id: ARRANGEMENT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
};

function member(role: string, overrides: Record<string, unknown> = {}) {
  return { role, status: 'active', ...overrides };
}

function makeAckRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (row: Record<string, unknown>) => ({
      id: 'ack-1',
      note: null,
      created_at: '2026-08-11T09:00:00.000Z',
      ...row,
    })),
    listForArrangement: mock(async () => []),
    ...overrides,
  };
}

function makePayRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async (id: string) =>
      id === ARRANGEMENT_ID ? ARRANGEMENT : null
    ),
    ...overrides,
  };
}

function makeMemberRepo(byUserId: Record<string, unknown>): any {
  return {
    findActiveMembership: mock(
      async (_h: string, userId: string) => byUserId[userId] ?? null
    ),
  };
}

function makePush(): any {
  return { notifyHouseholdParents: mock(() => {}) };
}

function service(
  parts: {
    ackRepo?: any;
    payRepo?: any;
    members?: Record<string, unknown>;
    push?: any;
  } = {}
): any {
  return new PayArrangementAckService(
    parts.ackRepo ?? makeAckRepo(),
    parts.payRepo ?? makePayRepo(),
    makeMemberRepo(parts.members ?? { [CARER_ID]: member('nanny') }),
    parts.push ?? makePush()
  );
}

describe('PayArrangementAckService.ack — only the carer herself, on her own arrangement', () => {
  it('the carer acks her own arrangement', async () => {
    const ackRepo = makeAckRepo();
    const svc = service({ ackRepo });
    const row = await svc.ack(CARER_ID, HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID);
    expect(row.id).toBe('ack-1');
    expect(ackRepo.create).toHaveBeenCalledTimes(1);
    expect(ackRepo.create.mock.calls[0][0]).toEqual({
      arrangement_id: ARRANGEMENT_ID,
      carer_id: CARER_ID,
      kind: 'seen',
      note: null,
    });
  });

  it('a parent may not ack on the carer’s behalf', async () => {
    const ackRepo = makeAckRepo();
    const svc = service({
      ackRepo,
      members: { 'parent-1': member('parent'), [CARER_ID]: member('nanny') },
    });
    await expect(
      svc.ack('parent-1', HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
    expect(ackRepo.create).not.toHaveBeenCalled();
  });

  it('refuses an arrangement that is not hers (D12-class)', async () => {
    const payRepo = makePayRepo({
      findById: mock(async () => ({
        id: ARRANGEMENT_ID,
        household_id: HOUSEHOLD_ID,
        carer_id: 'someone-else',
      })),
    });
    const svc = service({ payRepo });
    await expect(
      svc.ack(CARER_ID, HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('refuses an arrangement id that does not exist', async () => {
    const svc = service();
    await expect(
      svc.ack(CARER_ID, HOUSEHOLD_ID, CARER_ID, 'nope')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('never notifies anyone — an ack is a silent record', async () => {
    const push = makePush();
    const svc = service({ push });
    await svc.ack(CARER_ID, HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID);
    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
  });
});

describe('PayArrangementAckService.dissent — blocks nothing, notifies the parents', () => {
  it('records the dissent with an optional note', async () => {
    const ackRepo = makeAckRepo();
    const svc = service({ ackRepo });
    const row = await svc.dissent(
      CARER_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      ARRANGEMENT_ID,
      'The rate is wrong.'
    );
    expect(row.id).toBe('ack-1');
    expect(ackRepo.create.mock.calls[0][0]).toEqual({
      arrangement_id: ARRANGEMENT_ID,
      carer_id: CARER_ID,
      kind: 'disagreed',
      note: 'The rate is wrong.',
    });
  });

  it('records the dissent with no note when none is given', async () => {
    const ackRepo = makeAckRepo();
    const svc = service({ ackRepo });
    await svc.dissent(CARER_ID, HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID);
    expect(ackRepo.create.mock.calls[0][0].note).toBeNull();
  });

  it('notifies the household parents with pay_terms_disagreed, no figures', async () => {
    const push = makePush();
    const svc = service({ push });
    await svc.dissent(CARER_ID, HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID);
    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [householdId, payload] = push.notifyHouseholdParents.mock.calls[0];
    expect(householdId).toBe(HOUSEHOLD_ID);
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.PAY_TERMS_DISAGREED,
      householdId: HOUSEHOLD_ID,
    });
    expect(payload.title).not.toMatch(/\$|£|€/);
    expect(payload.body).not.toMatch(/\$|£|€/);
  });

  it('a parent may not record dissent on the carer’s behalf', async () => {
    const svc = service({
      members: { 'parent-1': member('parent'), [CARER_ID]: member('nanny') },
    });
    await expect(
      svc.dissent('parent-1', HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('fire-and-forget: dissent still succeeds when the push throws', async () => {
    const push = {
      notifyHouseholdParents: mock(() => {
        throw new Error('expo is down');
      }),
    };
    const svc = service({ push });
    const row = await svc.dissent(
      CARER_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      ARRANGEMENT_ID
    );
    expect(row.id).toBe('ack-1');
  });
});

describe('PayArrangementAckService.listForArrangement — both roles read', () => {
  it('a parent may read the acks for a carer in her household', async () => {
    const ackRepo = makeAckRepo({
      listForArrangement: mock(async () => [{ id: 'ack-1', kind: 'seen' }]),
    });
    const svc = service({
      ackRepo,
      members: { 'parent-1': member('parent'), [CARER_ID]: member('nanny') },
    });
    const rows = await svc.listForArrangement(
      'parent-1',
      HOUSEHOLD_ID,
      CARER_ID,
      ARRANGEMENT_ID
    );
    expect(rows).toHaveLength(1);
  });

  it('the carer may read her own acks', async () => {
    const svc = service();
    const rows = await svc.listForArrangement(
      CARER_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      ARRANGEMENT_ID
    );
    expect(rows).toEqual([]);
  });

  it('a helper may not read acks', async () => {
    const svc = service({
      members: { 'helper-1': member('helper'), [CARER_ID]: member('nanny') },
    });
    await expect(
      svc.listForArrangement('helper-1', HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('a non-member may not read acks', async () => {
    const svc = service();
    await expect(
      svc.listForArrangement('stranger', HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID)
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });
});

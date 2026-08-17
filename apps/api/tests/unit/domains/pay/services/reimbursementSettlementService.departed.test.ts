/**
 * `listUnsettled` AFTER A CARER DELETES HER ACCOUNT (033/058).
 *
 * Two defects, one pass, because fixing either alone is worse than fixing
 * neither:
 *
 *  1. The loop skipped every claim with a NULL `carer_id`, so money the family
 *     still owes a departed carer vanished from the aggregate the Today inbox
 *     is built from.
 *  2. `settledKeys` was `${carer_id}:${week}`, which collapses every departed
 *     carer in a week onto `"null:<week>"` — so the moment (1) is fixed, one
 *     departed carer's settlement silently masks another's outstanding claims.
 *
 * Both key on the same coalesce the SQL (061/069) and the client
 * (`carerKey.ts`) already use: `carer_id ?? household_member_id ?? name`.
 */
import { describe, expect, it, mock } from 'bun:test';
import { ReimbursementSettlementService } from '../../../../../src/domains/pay/services/reimbursementSettlementService';

const CARER_1 = 'carer-1';
/** Two DIFFERENT memberships, both since deleted — 058's whole point. */
const MEMBER_A = 'hm-a';
const MEMBER_B = 'hm-b';

function claim(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'e1',
    household_id: 'h1',
    carer_id: CARER_1,
    household_member_id: 'hm-1',
    carer_display_name: 'Marisol Reyes',
    local_date: '2026-08-04',
    kind: 'expense',
    description: 'Craft supplies',
    amount_minor: 1_250,
    miles: null,
    currency: 'GBP',
    status: 'approved',
    reviewed_by: 'parent-1',
    reviewed_at: '2026-08-05T09:00:00.000Z',
    review_note: null,
    created_at: '2026-08-04T09:00:00.000Z',
    updated_at: '2026-08-05T09:00:00.000Z',
    ...over,
  };
}

/** Emma left in July; her claims kept the membership stamp and her name. */
const departedA = (over: Record<string, unknown> = {}) =>
  claim({
    id: 'e-a',
    carer_id: null,
    household_member_id: MEMBER_A,
    carer_display_name: 'Emma Clarke',
    ...over,
  });

/** A SECOND departed carer, same week, same name — different membership. */
const departedB = (over: Record<string, unknown> = {}) =>
  claim({
    id: 'e-b',
    carer_id: null,
    household_member_id: MEMBER_B,
    carer_display_name: 'Emma Clarke',
    amount_minor: 4_000,
    ...over,
  });

function service(parts: {
  approved?: Record<string, unknown>[];
  settlements?: Record<string, unknown>[];
  scope?: { kind: 'household' } | { kind: 'own'; carerId: string };
}) {
  return new ReimbursementSettlementService(
    {
      listForHousehold: mock(async () => parts.settlements ?? []),
      listForWeek: mock(async () => []),
      create: mock(async () => ({})),
    } as any,
    {
      listApprovedForHousehold: mock(async () => parts.approved ?? []),
      listApprovedForWeek: mock(async () => []),
    } as any,
    {
      findActiveMembership: mock(async () => null),
      findMembershipAnyStatus: mock(async () => null),
    } as any,
    {
      findById: mock(async () => ({
        id: 'h1',
        timezone: 'Europe/London',
        week_starts_on: 1,
        currency: 'GBP',
      })),
    } as any,
    { notifyUser: mock(() => undefined) },
    {
      resolvePayrollReadScope: mock(
        async () => parts.scope ?? { kind: 'household' }
      ),
    } as any
  );
}

describe('listUnsettled — a carer who deleted her account still shows what she is owed', () => {
  it('includes a departed carer’s outstanding week', async () => {
    const svc = service({ approved: [departedA()] });

    const weeks = await svc.listUnsettled('parent-1', 'h1');

    expect(weeks).toEqual([
      {
        carer_id: null,
        household_member_id: MEMBER_A,
        carer_display_name: 'Emma Clarke',
        week_start: '2026-08-03',
        amount_minor: 1_250,
        currency: 'GBP',
      },
    ]);
  });

  it('carries the identity fields on a LIVE carer’s week too', async () => {
    const svc = service({ approved: [claim()] });

    const weeks = await svc.listUnsettled('parent-1', 'h1');

    expect(weeks[0]).toMatchObject({
      carer_id: CARER_1,
      household_member_id: 'hm-1',
      carer_display_name: 'Marisol Reyes',
      amount_minor: 1_250,
    });
  });

  it('keeps two departed carers in the SAME week apart, name collision and all', async () => {
    const svc = service({ approved: [departedA(), departedB()] });

    const weeks = await svc.listUnsettled('parent-1', 'h1');

    expect(weeks).toHaveLength(2);
    expect(weeks.map(w => w.household_member_id).sort()).toEqual([
      MEMBER_A,
      MEMBER_B,
    ]);
    expect(weeks.map(w => w.amount_minor).sort((a, b) => a - b)).toEqual([
      1_250, 4_000,
    ]);
  });

  it('one departed carer’s settlement does not mask the other’s claims', async () => {
    // The masking case in full: A was repaid before she left, B never was.
    // Neither settlement row can name either of them any more, so B must
    // still be reported — hiding money that is owed is the failure that
    // matters, and over-reporting A is visible and correctable.
    const svc = service({
      approved: [departedA(), departedB()],
      settlements: [{ carer_id: null, week_start: '2026-08-03' }],
    });

    const weeks = await svc.listUnsettled('parent-1', 'h1');

    expect(weeks.map(w => w.household_member_id)).toContain(MEMBER_B);
  });

  it('a live carer’s settlement still settles her own week and only hers', async () => {
    const svc = service({
      approved: [claim(), departedA()],
      settlements: [{ carer_id: CARER_1, week_start: '2026-08-03' }],
    });

    const weeks = await svc.listUnsettled('parent-1', 'h1');

    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.household_member_id).toBe(MEMBER_A);
  });

  it('does not re-bill an unambiguous departed week that was already settled', async () => {
    const svc = service({
      approved: [departedA()],
      settlements: [{ carer_id: null, week_start: '2026-08-03' }],
    });

    expect(await svc.listUnsettled('parent-1', 'h1')).toEqual([]);
  });

  it('sorts a mixed live/departed list without tripping over a null carer_id', async () => {
    const svc = service({
      approved: [
        departedB({ local_date: '2026-08-11' }),
        claim({ local_date: '2026-08-04' }),
        departedA({ local_date: '2026-08-11' }),
      ],
    });

    const weeks = await svc.listUnsettled('parent-1', 'h1');

    expect(weeks.map(w => w.week_start)).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-10',
    ]);
  });

  it('a nanny scope still sees only her own weeks, never a departed carer’s', async () => {
    const svc = service({
      approved: [claim(), departedA()],
      scope: { kind: 'own', carerId: CARER_1 },
    });

    const weeks = await svc.listUnsettled(CARER_1, 'h1');

    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.carer_id).toBe(CARER_1);
  });
});

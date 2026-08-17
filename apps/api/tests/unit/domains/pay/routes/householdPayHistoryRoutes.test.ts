/**
 * @module tests/unit/domains/pay/routes/householdPayHistoryRoutes
 *
 * THE TWO NEW ADDRESSES a departed carer's record needs (033/058), mounted
 * exactly as `routes/index.ts` mounts them: `ptoRoutes` under the
 * `/households/:householdId` prefix.
 *
 *   GET /households/:householdId/pto/ledger?year=YYYY
 *   GET /households/:householdId/pay-arrangements
 *
 * Same harness as `payArrangementRoutes.test.ts`: a real express app, the
 * REAL router, the REAL `validate()` and `errorHandler`, with only the auth
 * boundary and the two query services stubbed. What it proves is that the
 * routes exist, validate their params/query for real, and reach the right
 * service method with the resolved caller id — which is the entire complaint
 * these endpoints answer: before them, there was no address at all.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import type { AddressInfo } from 'node:net';

// Real RFC-4122 v4-shaped uuid — `z.uuid()` checks the version/variant
// nibbles, so an all-same-digit string is genuinely rejected.
const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTH_USER_ID = 'parent-1';

let server: import('node:http').Server;
let baseUrl: string;
let householdLedgerMock: ReturnType<typeof mock>;
let getHouseholdHistoryMock: ReturnType<typeof mock>;

beforeAll(async () => {
  householdLedgerMock = mock(async () => [
    { id: 'pl-2', carer_id: null, household_member_id: 'hm-2', minutes: -480 },
  ]);
  getHouseholdHistoryMock = mock(async () => [
    {
      id: 'pa-2',
      carer_id: null,
      household_member_id: 'hm-2',
      carer_display_name: 'Emma Clarke',
      rate_minor: 1_500,
      currency: 'GBP',
    },
  ]);

  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { id: AUTH_USER_ID };
      next();
    },
    validateSupabaseToken: mock((_req: any, _res: any, next: any) => next()),
    extractBearerToken: mock(() => null),
  }));
  mock.module(
    '../../../../../src/domains/pay/services/ptoQueryService',
    () => ({
      ptoQueryService: {
        balance: mock(async () => ({})),
        ledger: mock(async () => []),
        householdLedger: (...args: unknown[]) => householdLedgerMock(...args),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/pay/services/payArrangementQueryService',
    () => ({
      payArrangementQueryService: {
        getCurrent: mock(async () => null),
        getHistory: mock(async () => []),
        getHouseholdHistory: (...args: unknown[]) =>
          getHouseholdHistoryMock(...args),
      },
    })
  );

  const express = (await import('express')).default;
  const ptoRoutes = (
    await import('../../../../../src/domains/pay/routes/ptoRoutes')
  ).default;
  const { requestId } = await import(
    '../../../../../src/middlewares/requestId'
  );
  const { errorHandler } = await import(
    '../../../../../src/middlewares/errorHandler'
  );

  const app = express();
  app.use(requestId);
  app.use(express.json());
  // The EXACT prefix `routes/index.ts` mounts this router at.
  app.use('/households/:householdId', ptoRoutes);
  app.use(errorHandler);

  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

beforeEach(() => {
  householdLedgerMock.mockClear();
  getHouseholdHistoryMock.mockClear();
});

describe('GET /households/:householdId/pto/ledger', () => {
  it('reaches the household-scoped service with the caller and the year', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/pto/ledger?year=2026`
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(householdLedgerMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      HOUSEHOLD_ID,
      2026
    );
    expect(body.data.pto_ledger_entries[0].household_member_id).toBe('hm-2');
  });

  it('rejects a non-uuid householdId before the service is called', async () => {
    const res = await fetch(`${baseUrl}/households/nope/pto/ledger?year=2026`);

    expect(res.status).toBe(400);
    expect(householdLedgerMock).not.toHaveBeenCalled();
  });

  it('rejects a nonsense year with the same query schema the carer route uses', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/pto/ledger?year=banana`
    );

    expect(res.status).toBe(400);
    expect(householdLedgerMock).not.toHaveBeenCalled();
  });
});

describe('GET /households/:householdId/pay-arrangements', () => {
  it('reaches the household-scoped service with the caller', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/pay-arrangements`
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(getHouseholdHistoryMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      HOUSEHOLD_ID
    );
    expect(body.data.pay_arrangements[0].carer_display_name).toBe(
      'Emma Clarke'
    );
  });

  it('carries the same server-computed weekly-equivalent as the carer list', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/pay-arrangements`
    );
    const body = (await res.json()) as any;

    expect(body.data.pay_arrangements[0]).toHaveProperty(
      'weekly_equivalent_minor'
    );
  });

  it('rejects a non-uuid householdId before the service is called', async () => {
    const res = await fetch(`${baseUrl}/households/nope/pay-arrangements`);

    expect(res.status).toBe(400);
    expect(getHouseholdHistoryMock).not.toHaveBeenCalled();
  });
});

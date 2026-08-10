/**
 * @module tests/unit/domains/pay/routes/householdPaymentRoutes
 *
 * A MOUNTED-ROUTER test, the same shape and for the same reason as
 * `paymentRoutes.test.ts`: build a real `express()` app, mount the REAL
 * `householdPaymentRoutes` router at the exact path `routes/index.ts` uses,
 * with the REAL `validate()` middleware and the REAL `errorHandler`, and stub
 * ONLY the auth boundary plus the one service the controller calls.
 *
 * WHAT THIS PROVES
 *  - `:householdId` is really validated as a uuid, BEFORE the service is
 *    reached.
 *  - The controller passes the auth user id and the route param through, and
 *    answers 200 with the `{ payments }` envelope
 *    (`PaymentListResponseSchema`).
 *  - There is NO POST here: recording a payment stays week-scoped, where the
 *    over-payment gate lives.
 *
 * WHAT THIS DOES NOT PROVE
 *  - Any authorization — the service is mocked out entirely; its gate is
 *    tested in `paymentQueryService.householdList.test.ts`.
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
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { AuthenticationError } from '../../../../../src/errors';

// A real RFC-4122 v4-shaped uuid — `z.uuid()` validates the version/variant
// nibbles, so an all-same-digit string is genuinely rejected.
const HOUSEHOLD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEFAULT_AUTH_USER_ID = 'parent-1';
const MOUNT_PATH = '/households/:householdId/payments';

let server: import('node:http').Server;
let baseUrl: string;

let listMock: ReturnType<typeof mock>;
let requireAuthMock: ReturnType<typeof mock>;

beforeAll(async () => {
  listMock = mock(async () => [{ id: 'pay-1', amount_minor: 5_000 }]);

  requireAuthMock = mock((req: any, _res: any, next: any) => {
    req.user = { id: DEFAULT_AUTH_USER_ID };
    next();
  });
  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (req: any, res: any, next: any) =>
      requireAuthMock(req, res, next),
    validateSupabaseToken: mock((_req: any, _res: any, next: any) => next()),
    extractBearerToken: mock(() => null),
  }));

  mock.module(
    '../../../../../src/domains/pay/services/paymentQueryService',
    () => ({
      paymentQueryService: {
        listForHousehold: (...args: unknown[]) => listMock(...args),
      },
    })
  );

  // Dynamic imports AFTER every mock.module() call (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const householdPaymentRoutes = (
    await import('../../../../../src/domains/pay/routes/householdPaymentRoutes')
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
  app.use(MOUNT_PATH, householdPaymentRoutes);
  app.use(errorHandler);

  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

beforeEach(() => {
  listMock.mockClear();
  requireAuthMock.mockClear();
  requireAuthMock.mockImplementation((req: any, _res: any, next: any) => {
    req.user = { id: DEFAULT_AUTH_USER_ID };
    next();
  });
});

function pathFor(householdId: string): string {
  return `/households/${householdId}/payments`;
}

describe('householdPaymentRoutes — mounted router', () => {
  it('a non-uuid householdId is rejected with 400 BEFORE the query service is called', async () => {
    const res = await fetch(`${baseUrl}${pathFor('not-a-uuid')}`);

    expect(res.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
    expect(requireAuthMock).toHaveBeenCalled();
  });

  it('a valid uuid reaches the controller: 200 with the payments envelope', async () => {
    const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}`);
    const json = (await res.json()) as { data: { payments: unknown } };

    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      payments: [{ id: 'pay-1', amount_minor: 5_000 }],
    });
    expect(listMock).toHaveBeenCalledWith(DEFAULT_AUTH_USER_ID, HOUSEHOLD_ID);
  });

  it('an auth denial short-circuits the chain', async () => {
    requireAuthMock.mockImplementation((_req: any, _res: any, next: any) => {
      next(new AuthenticationError('User not authenticated'));
    });

    const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}`);

    expect(res.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('there is no POST here — recording stays week-scoped, where the over-payment gate lives', async () => {
    const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_minor: 5_000, paid_at: '2026-08-11' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('mount path (static evidence only — see the file header)', () => {
  it('routes/index.ts mounts householdPaymentRoutes at the exact path exercised above', () => {
    const indexSource = readFileSync(
      join(__dirname, '../../../../../src/routes/index.ts'),
      'utf-8'
    );

    expect(indexSource).toContain(
      `router.use('${MOUNT_PATH}', householdPaymentRoutes);`
    );
  });
});

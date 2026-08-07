/**
 * @module tests/unit/domains/pay/routes/paymentRoutes
 *
 * A MOUNTED-ROUTER test, the same shape and for the same reason as
 * `payArrangementRoutes.test.ts`: build a real `express()` app, mount the
 * REAL `paymentRoutes` router at the exact path `routes/index.ts` uses, with
 * the REAL `validate()` middleware and the REAL `errorHandler`, and stub ONLY
 * the auth boundary plus the two services the controller calls.
 *
 * WHAT THIS PROVES
 *  - `:timesheetId` is really validated as a uuid, BEFORE either service is
 *    reached.
 *  - `CreatePaymentSchema` really rejects a zero/negative `amount_minor` and
 *    a malformed `paid_at` with a 400 — an invalid POST never reaches the
 *    append-only write path.
 *  - The wire body carries NO currency: a client that sends one has it
 *    stripped by the schema, so the server's stamped currency is the only one
 *    that can reach the service (`docs/11-MONEY.md` §1, migration 067).
 *  - The controller passes the auth user id, the route param and the parsed
 *    body through, and answers 201 (create) / 200 (list).
 *
 * WHAT THIS DOES NOT PROVE
 *  - That the full `/api/v1` router mounts this at the same path in the real
 *    app — the static-source assertion at the bottom is textual evidence the
 *    two strings have not drifted, not an HTTP-level proof.
 *  - Any authorization: both services are mocked out entirely here, and their
 *    gates are tested in `paymentCommandService.test.ts` /
 *    `paymentQueryService.test.ts`.
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
const TIMESHEET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEFAULT_AUTH_USER_ID = 'parent-1';
const MOUNT_PATH = '/timesheets/:timesheetId/payments';

let server: import('node:http').Server;
let baseUrl: string;

let listMock: ReturnType<typeof mock>;
let createMock: ReturnType<typeof mock>;
let requireAuthMock: ReturnType<typeof mock>;

beforeAll(async () => {
  listMock = mock(async () => [{ id: 'pay-1', amount_minor: 5_000 }]);
  createMock = mock(async (..._args: unknown[]) => ({
    id: 'pay-new',
    amount_minor: 5_000,
  }));

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
        listForTimesheet: (...args: unknown[]) => listMock(...args),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/pay/services/paymentCommandService',
    () => ({
      paymentCommandService: {
        create: (...args: unknown[]) => createMock(...args),
      },
    })
  );

  // Dynamic imports AFTER every mock.module() call (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const paymentRoutes = (
    await import('../../../../../src/domains/pay/routes/paymentRoutes')
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
  app.use(MOUNT_PATH, paymentRoutes);
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
  createMock.mockClear();
  requireAuthMock.mockClear();
  requireAuthMock.mockImplementation((req: any, _res: any, next: any) => {
    req.user = { id: DEFAULT_AUTH_USER_ID };
    next();
  });
});

function pathFor(timesheetId: string): string {
  return `/timesheets/${timesheetId}/payments`;
}

function post(timesheetId: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${pathFor(timesheetId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('paymentRoutes — mounted router', () => {
  describe('GET /', () => {
    it('a non-uuid timesheetId is rejected with 400 BEFORE the query service is called', async () => {
      const res = await fetch(`${baseUrl}${pathFor('not-a-uuid')}`);

      expect(res.status).toBe(400);
      expect(listMock).not.toHaveBeenCalled();
      expect(requireAuthMock).toHaveBeenCalled();
    });

    it('a valid uuid reaches the controller: 200 with the payments envelope', async () => {
      const res = await fetch(`${baseUrl}${pathFor(TIMESHEET_ID)}`);
      const json = (await res.json()) as { data: { payments: unknown } };

      expect(res.status).toBe(200);
      expect(json.data).toEqual({
        payments: [{ id: 'pay-1', amount_minor: 5_000 }],
      });
      expect(listMock).toHaveBeenCalledWith(DEFAULT_AUTH_USER_ID, TIMESHEET_ID);
    });

    it('an auth denial short-circuits the chain', async () => {
      requireAuthMock.mockImplementation((_req: any, _res: any, next: any) => {
        next(new AuthenticationError('User not authenticated'));
      });

      const res = await fetch(`${baseUrl}${pathFor(TIMESHEET_ID)}`);

      expect(res.status).toBe(401);
      expect(listMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /', () => {
    it('a valid body reaches the controller: 201, called with the user id, the route param and the body', async () => {
      const res = await post(TIMESHEET_ID, {
        amount_minor: 5_000,
        paid_at: '2026-08-11',
        method_note: 'Bank transfer',
      });
      const json = (await res.json()) as { data: { payment: unknown } };

      expect(res.status).toBe(201);
      expect(json.data).toEqual({
        payment: { id: 'pay-new', amount_minor: 5_000 },
      });
      expect(createMock).toHaveBeenCalledWith(
        DEFAULT_AUTH_USER_ID,
        TIMESHEET_ID,
        {
          amount_minor: 5_000,
          paid_at: '2026-08-11',
          method_note: 'Bank transfer',
        }
      );
    });

    it('a zero amount is rejected with 400 — a payment of nothing is not a payment', async () => {
      const res = await post(TIMESHEET_ID, {
        amount_minor: 0,
        paid_at: '2026-08-11',
      });

      expect(res.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('a negative amount is rejected with 400', async () => {
      const res = await post(TIMESHEET_ID, {
        amount_minor: -5_000,
        paid_at: '2026-08-11',
      });

      expect(res.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('a malformed paid_at is rejected with 400', async () => {
      const res = await post(TIMESHEET_ID, {
        amount_minor: 5_000,
        paid_at: '11/08/2026',
      });

      expect(res.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('a client-supplied currency never reaches the service — the server stamps it', async () => {
      await post(TIMESHEET_ID, {
        amount_minor: 5_000,
        paid_at: '2026-08-11',
        currency: 'USD',
      });

      expect(createMock).toHaveBeenCalledWith(
        DEFAULT_AUTH_USER_ID,
        TIMESHEET_ID,
        { amount_minor: 5_000, paid_at: '2026-08-11' }
      );
    });

    it('a non-uuid timesheetId on POST is rejected before the body is even validated', async () => {
      const res = await post('not-a-uuid', {
        amount_minor: 5_000,
        paid_at: '2026-08-11',
      });

      expect(res.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('mount path (static evidence only — see the file header)', () => {
    it('routes/index.ts mounts paymentRoutes at the exact path exercised above', () => {
      const indexSource = readFileSync(
        join(__dirname, '../../../../../src/routes/index.ts'),
        'utf-8'
      );
      expect(indexSource).toContain(`'${MOUNT_PATH}'`);
      expect(indexSource).toContain('paymentRoutes');
    });
  });
});

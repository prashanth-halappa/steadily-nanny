/**
 * @module tests/unit/domains/pay/routes/payArrangementRoutes
 *
 * Review finding 3a: a MOUNTED-ROUTER test — every other pay-domain test in
 * this repo exercises the controller or service in isolation (a plain
 * object standing in for `req`/`res`), which never proves the actual
 * Express wiring — the preset chain (`authWithValidation`), the real Zod
 * param/body validation, and the real `errorHandler` — behaves as the route
 * file declares.
 *
 * Approach: build a real `express()` app, mount the REAL
 * `payArrangementRoutes` router at the exact path `routes/index.ts` uses,
 * with the REAL `validate()` middleware, the REAL `errorHandler`, and the
 * REAL `requestId` middleware — and stub ONLY the auth boundary
 * (`requireAuth`, imported by `middlewares/presets.ts`) plus the two
 * service modules the controller calls into. Requests are made with a real
 * HTTP server (`app.listen(0)` + `fetch`) rather than a mocked req/res pair,
 * so the assertions below exercise the actual Express routing/middleware
 * pipeline, not a stand-in for it.
 *
 * There is no `supertest` dependency in this repo (checked
 * `apps/api/package.json`) and this task's file allowlist is exactly one
 * new test file, so adding one was out of scope — a real listening server +
 * `fetch` is the closest real thing without inventing a new test harness
 * dependency.
 *
 * WHAT THIS PROVES:
 *  - `HouseholdCarerParamSchema` really rejects a non-uuid `carerId` with a
 *    400, and does so BEFORE the query service is ever called.
 *  - A valid (householdId, carerId) pair reaches the controller, which
 *    calls the (mocked) query service with the resolved auth user id and
 *    both route params, and the router answers 200 with its result.
 *  - `CreatePayArrangementRequestSchema` really rejects a negative
 *    `rate_minor` with a 400, and does so BEFORE the command service is
 *    ever called (append-only guarantee: an invalid POST never reaches the
 *    write path).
 *  - The auth boundary is real middleware in the real chain — a denial from
 *    (a stubbed) `requireAuth` still short-circuits before validation runs.
 *
 * WHAT THIS DOES NOT PROVE:
 *  - That `routes/index.ts` actually mounts `payArrangementRoutes` at
 *    `/api/v1/households/:householdId/carers/:carerId/pay-arrangements` in
 *    the real running app — mounting the FULL `/api/v1` router here would
 *    transitively import every other domain's routes/services (a much
 *    heavier and more fragile test), so this file mounts
 *    `payArrangementRoutes` directly at the same path string
 *    `routes/index.ts` uses. The static-source assertion in the "mount
 *    path" describe block below is a textual check that the string used to
 *    mount it in `routes/index.ts` is exactly the one exercised here — real
 *    evidence the two haven't drifted, but not an HTTP-level proof of the
 *    full app's wiring.
 *  - That `validateSupabaseToken` (the real Supabase JWT verification) ever
 *    runs — `requireAuth` is stubbed to skip straight to "authenticated as
 *    this user id", so no real-token/expired-token/malformed-header
 *    behavior is exercised here. That belongs to a test of `middlewares/auth.ts`
 *    itself, not this route file.
 *  - Ownership/membership authorization (e.g. a helper reading a pay
 *    arrangement they have no business seeing) — that lives inside the two
 *    services, which are mocked out here entirely.
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

// Real RFC-4122 v4-shaped uuids — zod's `z.uuid()` validates the version
// (1-8) and variant (8/9/a/b) nibbles, not just "8 hex groups", so an
// all-same-digit string like "11111111-1111-1111-1111-111111111111" is
// actually rejected as malformed by the schema under test.
const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARER_ID = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const DEFAULT_AUTH_USER_ID = 'parent-1';

let app: import('express').Express;
let server: import('node:http').Server;
let baseUrl: string;

const ARRANGEMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let getCurrentMock: ReturnType<typeof mock>;
let getHistoryMock: ReturnType<typeof mock>;
let createMock: ReturnType<typeof mock>;
let cancelScheduledMock: ReturnType<typeof mock>;
let ackMock: ReturnType<typeof mock>;
let dissentMock: ReturnType<typeof mock>;
let listAcksMock: ReturnType<typeof mock>;
let requireAuthMock: ReturnType<typeof mock>;

beforeAll(async () => {
  getCurrentMock = mock(async () => ({ id: 'pa-1', rate_minor: 1500 }));
  getHistoryMock = mock(async () => [{ id: 'pa-1' }]);
  createMock = mock(async (..._args: unknown[]) => ({
    id: 'pa-new',
    rate_minor: 1500,
  }));
  cancelScheduledMock = mock(async () => ({
    id: 'pa-reverted',
    rate_minor: 1500,
  }));
  ackMock = mock(async () => ({ id: 'ack-1', kind: 'seen' }));
  dissentMock = mock(async () => ({ id: 'ack-2', kind: 'disagreed' }));
  listAcksMock = mock(async () => [{ id: 'ack-1', kind: 'seen' }]);

  // Stub the AUTH layer only. `middlewares/presets.ts`'s `authWithValidation`
  // imports `requireAuth` from this module — mocking it here (before the
  // dynamic import below) means every downstream `authWithValidation(...)`
  // chain gets the stub, while `validate()` (zod param/body validation,
  // imported from a DIFFERENT module) stays completely real.
  requireAuthMock = mock((req: any, _res: any, next: any) => {
    req.user = { id: DEFAULT_AUTH_USER_ID };
    next();
  });
  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (req: any, res: any, next: any) =>
      requireAuthMock(req, res, next),
    // Not exercised by these routes, but re-exported in case anything else
    // in the transitive import graph reaches for it.
    validateSupabaseToken: mock((_req: any, _res: any, next: any) => next()),
    extractBearerToken: mock(() => null),
  }));

  mock.module(
    '../../../../../src/domains/pay/services/payArrangementQueryService',
    () => ({
      payArrangementQueryService: {
        getCurrent: (...args: unknown[]) => getCurrentMock(...args),
        getHistory: (...args: unknown[]) => getHistoryMock(...args),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/pay/services/payArrangementCommandService',
    () => ({
      payArrangementCommandService: {
        create: (...args: unknown[]) => createMock(...args),
        cancelScheduled: (...args: unknown[]) => cancelScheduledMock(...args),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/pay/services/payArrangementAckService',
    () => ({
      payArrangementAckService: {
        ack: (...args: unknown[]) => ackMock(...args),
        dissent: (...args: unknown[]) => dissentMock(...args),
        listForArrangement: (...args: unknown[]) => listAcksMock(...args),
      },
    })
  );

  // Dynamic imports AFTER every mock.module() call above (docs/09-TESTING.md
  // §4) — Bun resolves a module's dependency graph at import time.
  const express = (await import('express')).default;
  const payArrangementRoutes = (
    await import('../../../../../src/domains/pay/routes/payArrangementRoutes')
  ).default;
  const { requestId } = await import(
    '../../../../../src/middlewares/requestId'
  );
  const { errorHandler } = await import(
    '../../../../../src/middlewares/errorHandler'
  );

  app = express();
  app.use(requestId);
  app.use(express.json());
  // The EXACT path string `routes/index.ts` mounts this router at — see the
  // "mount path" describe block below for the static check that the two
  // haven't drifted.
  app.use(
    '/households/:householdId/carers/:carerId/pay-arrangements',
    payArrangementRoutes
  );
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
  getCurrentMock.mockClear();
  getHistoryMock.mockClear();
  createMock.mockClear();
  cancelScheduledMock.mockClear();
  ackMock.mockClear();
  dissentMock.mockClear();
  listAcksMock.mockClear();
  requireAuthMock.mockClear();
  requireAuthMock.mockImplementation((req: any, _res: any, next: any) => {
    req.user = { id: DEFAULT_AUTH_USER_ID };
    next();
  });
});

function pathFor(householdId: string, carerId: string, suffix = '/current') {
  return `/households/${householdId}/carers/${carerId}/pay-arrangements${suffix}`;
}

describe('payArrangementRoutes — mounted router', () => {
  describe('GET .../current', () => {
    it('a non-uuid carerId is rejected with 400 BEFORE the query service is ever called', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, 'not-a-uuid')}`
      );

      expect(res.status).toBe(400);
      expect(getCurrentMock).not.toHaveBeenCalled();
      // requireAuth DID run — validation is what rejected this, not auth.
      expect(requireAuthMock).toHaveBeenCalled();
    });

    it('a non-uuid householdId is rejected with 400 too', async () => {
      const res = await fetch(`${baseUrl}${pathFor('not-a-uuid', CARER_ID)}`);

      expect(res.status).toBe(400);
      expect(getCurrentMock).not.toHaveBeenCalled();
    });

    it('valid uuids reach the controller: 200, and the query service is called with the auth user id + both route params', async () => {
      const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID)}`);
      const body = (await res.json()) as {
        data: { pay_arrangement: unknown };
      };

      expect(res.status).toBe(200);
      // D-6/§10: the controller attaches weekly_equivalent_minor (null here
      // — the stub carries no guaranteed_minutes_per_week).
      expect(body.data).toEqual({
        pay_arrangement: {
          id: 'pa-1',
          rate_minor: 1500,
          weekly_equivalent_minor: null,
        },
      });
      expect(getCurrentMock).toHaveBeenCalledWith(
        DEFAULT_AUTH_USER_ID,
        HOUSEHOLD_ID,
        CARER_ID
      );
    });

    it('an auth denial short-circuits before validation would even matter (the auth boundary is real middleware, not skipped)', async () => {
      requireAuthMock.mockImplementation((_req: any, _res: any, next: any) => {
        next(new AuthenticationError('User not authenticated'));
      });

      const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID)}`);

      expect(res.status).toBe(401);
      expect(getCurrentMock).not.toHaveBeenCalled();
    });
  });

  describe('POST .../ (create)', () => {
    it('a negative rate_minor is rejected with 400 BEFORE the command service is ever called', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, '/')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rate_minor: -100,
            currency: 'GBP',
            valid_from: '2026-08-04',
          }),
        }
      );

      expect(res.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('a valid body reaches the controller: 201, and the command service is called with the auth user id + both route params + the body', async () => {
      const body = {
        rate_minor: 1850,
        currency: 'GBP',
        valid_from: '2026-08-04',
      };
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, '/')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const json = (await res.json()) as { data: { pay_arrangement: unknown } };

      expect(res.status).toBe(201);
      expect(json.data).toEqual({
        pay_arrangement: { id: 'pa-new', rate_minor: 1500 },
      });
      expect(createMock).toHaveBeenCalledWith(
        DEFAULT_AUTH_USER_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        expect.objectContaining(body)
      );
    });

    it('a non-uuid carerId on POST is rejected with 400 before the body is even validated', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, 'not-a-uuid', '/')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rate_minor: 1850,
            currency: 'GBP',
            valid_from: '2026-08-04',
          }),
        }
      );

      expect(res.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('POST .../:arrangementId/ack (D-31)', () => {
    it('a non-uuid arrangementId is rejected with 400 before the service is called', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, '/not-a-uuid/ack')}`,
        { method: 'POST' }
      );
      expect(res.status).toBe(400);
      expect(ackMock).not.toHaveBeenCalled();
    });

    it('a valid request reaches the controller: 201, called with auth user id + all three route params', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, `/${ARRANGEMENT_ID}/ack`)}`,
        { method: 'POST' }
      );
      expect(res.status).toBe(201);
      expect(ackMock).toHaveBeenCalledWith(
        DEFAULT_AUTH_USER_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        ARRANGEMENT_ID
      );
    });
  });

  describe('POST .../:arrangementId/dissent (D-45)', () => {
    it('a note over 280 chars is rejected with 400 before the service is called', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, `/${ARRANGEMENT_ID}/dissent`)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'x'.repeat(281) }),
        }
      );
      expect(res.status).toBe(400);
      expect(dissentMock).not.toHaveBeenCalled();
    });

    it('a valid note reaches the controller: 201, note forwarded to the service', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, `/${ARRANGEMENT_ID}/dissent`)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'The rate is wrong.' }),
        }
      );
      expect(res.status).toBe(201);
      expect(dissentMock).toHaveBeenCalledWith(
        DEFAULT_AUTH_USER_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        ARRANGEMENT_ID,
        'The rate is wrong.'
      );
    });

    it('an empty body is valid — note is optional', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, `/${ARRANGEMENT_ID}/dissent`)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      expect(res.status).toBe(201);
      expect(dissentMock).toHaveBeenCalledWith(
        DEFAULT_AUTH_USER_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        ARRANGEMENT_ID,
        undefined
      );
    });
  });

  describe('GET .../:arrangementId/acks', () => {
    it('reaches the controller: 200 with the ack list', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, `/${ARRANGEMENT_ID}/acks`)}`
      );
      const body = (await res.json()) as {
        data: { pay_arrangement_acks: unknown[] };
      };
      expect(res.status).toBe(200);
      expect(body.data.pay_arrangement_acks).toEqual([
        { id: 'ack-1', kind: 'seen' },
      ]);
      expect(listAcksMock).toHaveBeenCalledWith(
        DEFAULT_AUTH_USER_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        ARRANGEMENT_ID
      );
    });
  });

  describe('POST .../:arrangementId/cancel-scheduled (D-16/§6)', () => {
    it('a non-uuid arrangementId is rejected with 400 before the service is called', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, '/not-a-uuid/cancel-scheduled')}`,
        { method: 'POST' }
      );
      expect(res.status).toBe(400);
      expect(cancelScheduledMock).not.toHaveBeenCalled();
    });

    it('a valid request reaches the controller: 200, called with auth user id + all three route params', async () => {
      const res = await fetch(
        `${baseUrl}${pathFor(HOUSEHOLD_ID, CARER_ID, `/${ARRANGEMENT_ID}/cancel-scheduled`)}`,
        { method: 'POST' }
      );
      expect(res.status).toBe(200);
      expect(cancelScheduledMock).toHaveBeenCalledWith(
        DEFAULT_AUTH_USER_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        ARRANGEMENT_ID
      );
    });
  });

  describe('mount path (static evidence only — see the file header)', () => {
    it('routes/index.ts mounts payArrangementRoutes at the exact path exercised above', () => {
      const indexSource = readFileSync(
        join(__dirname, '../../../../../src/routes/index.ts'),
        'utf-8'
      );
      expect(indexSource).toContain(
        "'/households/:householdId/carers/:carerId/pay-arrangements'"
      );
      expect(indexSource).toContain('payArrangementRoutes');
    });
  });
});

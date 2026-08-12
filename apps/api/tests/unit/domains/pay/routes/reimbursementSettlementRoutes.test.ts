/**
 * @module tests/unit/domains/pay/routes/reimbursementSettlementRoutes
 *
 * A MOUNTED-ROUTER test, the same shape and for the same reason as
 * `householdPaymentRoutes.test.ts`: a real `express()` app, the REAL router
 * mounted at the exact path `routes/index.ts` uses, the REAL `validate()`
 * middleware and `errorHandler`, and ONLY the auth boundary plus the one
 * service stubbed.
 *
 * WHAT THIS PROVES
 *  - `:householdId` is validated as a uuid BEFORE the service is reached.
 *  - `?weekStart=` is validated as an ISO date and reaches the service.
 *  - The POST body is validated against the SHARED
 *    `CreateReimbursementSettlementSchema`, and a body carrying an
 *    `amount_minor` cannot smuggle a figure through (the server computes it).
 *  - There is no PATCH and no DELETE — the table is append-only.
 *
 * WHAT THIS DOES NOT PROVE
 *  - Any authorization; the service is mocked out. Its gates are tested in
 *    `reimbursementSettlementService.test.ts`.
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

/** Real RFC-4122 v4-shaped uuids — `z.uuid()` checks the version/variant nibbles. */
const HOUSEHOLD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CARER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEFAULT_AUTH_USER_ID = 'parent-1';
const MOUNT_PATH = '/households/:householdId/reimbursement-settlements';

let server: import('node:http').Server;
let baseUrl: string;

let listMock: ReturnType<typeof mock>;
let listUnsettledMock: ReturnType<typeof mock>;
let createMock: ReturnType<typeof mock>;
let requireAuthMock: ReturnType<typeof mock>;

beforeAll(async () => {
  listMock = mock(async () => [{ id: 'set-1', amount_minor: 14_600 }]);
  listUnsettledMock = mock(async () => [
    {
      carer_id: CARER_ID,
      week_start: '2026-08-03',
      amount_minor: 2_240,
      currency: 'GBP',
    },
  ]);
  createMock = mock(async () => ({ id: 'set-new', amount_minor: 14_600 }));

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
    '../../../../../src/domains/pay/services/reimbursementSettlementService',
    () => ({
      reimbursementSettlementService: {
        listForWeek: (...args: unknown[]) => listMock(...args),
        listUnsettled: (...args: unknown[]) => listUnsettledMock(...args),
        create: (...args: unknown[]) => createMock(...args),
      },
    })
  );

  // Dynamic imports AFTER every mock.module() call (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const reimbursementSettlementRoutes = (
    await import(
      '../../../../../src/domains/pay/routes/reimbursementSettlementRoutes'
    )
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
  app.use(MOUNT_PATH, reimbursementSettlementRoutes);
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
  listUnsettledMock.mockClear();
  createMock.mockClear();
  requireAuthMock.mockClear();
  requireAuthMock.mockImplementation((req: any, _res: any, next: any) => {
    req.user = { id: DEFAULT_AUTH_USER_ID };
    next();
  });
});

function pathFor(householdId: string): string {
  return `/households/${householdId}/reimbursement-settlements`;
}

const VALID_BODY = {
  carer_id: CARER_ID,
  week_start: '2026-08-03',
  settled_at: '2026-08-10',
  note: 'Cash on Friday',
};

describe('reimbursementSettlementRoutes — GET', () => {
  it('a non-uuid householdId is 400 BEFORE the service is called', async () => {
    const res = await fetch(`${baseUrl}${pathFor('not-a-uuid')}`);

    expect(res.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('200 with the { settlements } envelope, weekStart omitted', async () => {
    const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}`);
    const json = (await res.json()) as { data: { settlements: unknown } };

    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      settlements: [{ id: 'set-1', amount_minor: 14_600 }],
    });
    expect(listMock).toHaveBeenCalledWith(
      DEFAULT_AUTH_USER_ID,
      HOUSEHOLD_ID,
      undefined
    );
  });

  it('a valid weekStart reaches the service', async () => {
    const res = await fetch(
      `${baseUrl}${pathFor(HOUSEHOLD_ID)}?weekStart=2026-08-03`
    );

    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(
      DEFAULT_AUTH_USER_ID,
      HOUSEHOLD_ID,
      '2026-08-03'
    );
  });

  it('GET /unsettled returns the { weeks } envelope', async () => {
    const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}/unsettled`);
    const json = (await res.json()) as {
      data: { weeks: { amount_minor: number }[] };
    };

    expect(res.status).toBe(200);
    expect(json.data.weeks[0]?.amount_minor).toBe(2_240);
    expect(listUnsettledMock).toHaveBeenCalledWith(
      DEFAULT_AUTH_USER_ID,
      HOUSEHOLD_ID
    );
  });

  it('a malformed weekStart is 400, never a silent fallback to this week', async () => {
    const res = await fetch(
      `${baseUrl}${pathFor(HOUSEHOLD_ID)}?weekStart=03-08-2026`
    );

    expect(res.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('an auth denial short-circuits the chain', async () => {
    requireAuthMock.mockImplementation((_req: any, _res: any, next: any) => {
      next(new AuthenticationError('User not authenticated'));
    });

    const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}`);

    expect(res.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('reimbursementSettlementRoutes — POST', () => {
  it('201 with the { settlement } envelope', async () => {
    const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    const json = (await res.json()) as { data: { settlement: unknown } };

    expect(res.status).toBe(201);
    expect(json.data).toEqual({
      settlement: { id: 'set-new', amount_minor: 14_600 },
    });
    expect(createMock).toHaveBeenCalledWith(
      DEFAULT_AUTH_USER_ID,
      HOUSEHOLD_ID,
      VALID_BODY
    );
  });

  it('a missing carer_id is 400 before the service', async () => {
    const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        week_start: '2026-08-03',
        settled_at: '2026-08-10',
      }),
    });

    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('a body cannot smuggle an amount through — the server computes it', async () => {
    const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, amount_minor: 1, currency: 'XXX' }),
    });

    expect(res.status).toBe(201);
    const [, , forwarded] = createMock.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(forwarded.amount_minor).toBeUndefined();
    expect(forwarded.currency).toBeUndefined();
  });

  it('there is no PATCH and no DELETE — the table is append-only', async () => {
    for (const method of ['PATCH', 'DELETE']) {
      const res = await fetch(`${baseUrl}${pathFor(HOUSEHOLD_ID)}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'PATCH' ? JSON.stringify({}) : undefined,
      });
      expect(res.status).toBe(404);
    }
  });
});

describe('mount path (static evidence only — see the file header)', () => {
  it('routes/index.ts mounts the router at the exact path exercised above', () => {
    const indexSource = readFileSync(
      join(__dirname, '../../../../../src/routes/index.ts'),
      'utf-8'
    );

    // The call is wrapped over three lines by Biome, so the assertion is on
    // the path and the router name rather than one formatted line.
    expect(indexSource).toContain(`  '${MOUNT_PATH}',\n`);
    expect(indexSource).toContain('  reimbursementSettlementRoutes\n');
  });
});

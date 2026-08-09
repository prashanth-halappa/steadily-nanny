/**
 * POST /parent-cover must resolve before /:shiftId routes.
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

const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTH_USER_ID = 'parent-1';

let server: import('node:http').Server;
let baseUrl: string;
let createParentCoverMock: ReturnType<typeof mock>;

beforeAll(async () => {
  createParentCoverMock = mock(async () => ({
    id: 'pc1',
    household_id: HOUSEHOLD_ID,
    kind: 'parent_cover',
    status: 'confirmed',
    carer_id: null,
  }));

  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (
      req: { user?: { id: string } },
      _res: unknown,
      next: () => void
    ) => {
      req.user = { id: AUTH_USER_ID };
      next();
    },
    validateSupabaseToken: mock(
      (_req: unknown, _res: unknown, next: () => void) => next()
    ),
    extractBearerToken: mock(() => null),
  }));
  mock.module(
    '../../../../../src/domains/shift/services/shiftCommandService',
    () => ({
      shiftCommandService: {
        createParentCover: (...args: unknown[]) =>
          createParentCoverMock(...args),
        update: mock(async () => ({})),
        accept: mock(async () => ({})),
        decline: mock(async () => ({})),
        removeParentCover: mock(async () => undefined),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/shift/services/shiftChangeRequestCommandService',
    () => ({
      shiftChangeRequestCommandService: {
        createExtraShift: mock(async () => ({ status: 'created', shift: {} })),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/shift/services/shiftQueryService',
    () => ({
      shiftQueryService: {
        listForHousehold: mock(async () => []),
        listEvents: mock(async () => []),
      },
    })
  );

  const express = (await import('express')).default;
  const householdShiftRoutes = (
    await import('../../../../../src/domains/shift/routes/householdShiftRoutes')
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
  app.use(`/households/:householdId/shifts`, householdShiftRoutes);
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
  createParentCoverMock.mockClear();
});

describe('POST /households/:householdId/shifts/parent-cover route ordering', () => {
  it('resolves parent-cover literally and reaches createParentCover', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/shifts/parent-cover`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          starts_at: '2026-08-03T09:00:00.000Z',
          ends_at: '2026-08-03T12:00:00.000Z',
          child_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
      }
    );

    expect(res.status).toBe(200);
    expect(createParentCoverMock).toHaveBeenCalledTimes(1);
  });
});

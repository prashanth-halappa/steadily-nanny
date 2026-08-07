/**
 * @module tests/unit/domains/shift/routes/shiftRoutes.decline
 *
 * POST /shifts/:shiftId/decline is the symmetric "no" to
 * POST /shifts/:shiftId/accept, and it MUST sit behind the same guard: the
 * shared `shiftOwnership` lookup (`shiftQueryService.getOwned`), which throws
 * ShiftNotFoundError for both "missing" and "not a member". No service test
 * can prove that wiring — drop the middleware and every service test stays
 * green — so this mounts the REAL router with only `requireAuth` and the two
 * shift services stubbed, and drives it over HTTP.
 *
 * Approach copied from `tests/unit/domains/timesheet/routes/timesheetRoutes.test.ts`.
 * Distinct ids per case because `makeOwnershipValidator` caches BOTH positive
 * and negative results under `(userId, resourceId)`.
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

const OWNED_SHIFT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const FOREIGN_SHIFT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const AUTH_USER_ID = 'carer-1';

let server: import('node:http').Server;
let baseUrl: string;
let getOwnedMock: ReturnType<typeof mock>;
let declineMock: ReturnType<typeof mock>;

beforeAll(async () => {
  getOwnedMock = mock(async (_userId: unknown, shiftId: unknown) => {
    if (shiftId === FOREIGN_SHIFT_ID) {
      const { ShiftNotFoundError } = await import(
        '../../../../../src/domains/shift/errors/shiftErrors'
      );
      throw new ShiftNotFoundError(FOREIGN_SHIFT_ID);
    }
    return { id: shiftId, household_id: 'h1', carer_id: AUTH_USER_ID };
  });
  declineMock = mock(async (_userId: unknown, shiftId: unknown) => ({
    id: shiftId,
    status: 'declined',
    carer_id: AUTH_USER_ID,
  }));

  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { id: AUTH_USER_ID };
      next();
    },
    validateSupabaseToken: mock((_req: any, _res: any, next: any) => next()),
    extractBearerToken: mock(() => null),
  }));
  mock.module(
    '../../../../../src/domains/shift/services/shiftQueryService',
    () => ({
      shiftQueryService: {
        getOwned: (...args: unknown[]) => getOwnedMock(...args),
        listForHousehold: mock(async () => []),
        listEvents: mock(async () => []),
        listDayThread: mock(async () => []),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/shift/services/shiftCommandService',
    () => ({
      shiftCommandService: {
        decline: (...args: unknown[]) => declineMock(...args),
        accept: mock(async () => ({ id: OWNED_SHIFT_ID, carer_id: null })),
        update: mock(async () => ({ id: OWNED_SHIFT_ID, carer_id: null })),
      },
    })
  );
  mock.module('../../../../../src/domains/me/services/clashWarning', () => ({
    collectClashWarningsForCarer: mock(async () => []),
  }));

  // Dynamic imports AFTER every mock.module() (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const shiftRoutes = (
    await import('../../../../../src/domains/shift/routes/shiftRoutes')
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
  app.use('/shifts', shiftRoutes);
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
  getOwnedMock.mockClear();
  declineMock.mockClear();
});

function postDecline(shiftId: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}/shifts/${shiftId}/decline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('POST /shifts/:shiftId/decline', () => {
  it('is mounted and reaches the command service for a member', async () => {
    const res = await postDecline(OWNED_SHIFT_ID);

    expect(res.status).toBe(200);
    expect(declineMock).toHaveBeenCalledWith(AUTH_USER_ID, OWNED_SHIFT_ID);
    const body = (await res.json()) as { data: { shift: { status: string } } };
    expect(body.data.shift.status).toBe('declined');
  });

  it('404s a non-member through the shared ownership lookup, never reaching the service', async () => {
    const res = await postDecline(FOREIGN_SHIFT_ID);

    expect(res.status).toBe(404);
    expect(getOwnedMock).toHaveBeenCalledWith(AUTH_USER_ID, FOREIGN_SHIFT_ID);
    expect(declineMock).not.toHaveBeenCalled();
  });

  it('400s a non-uuid shift id before the controller runs', async () => {
    const res = await postDecline('not-a-uuid');

    expect(res.status).toBe(400);
    expect(declineMock).not.toHaveBeenCalled();
  });

  it('is body-less — an unexpected body is ignored, not validated', async () => {
    // Deliberately no `validate(..., 'body')` on this route, exactly like
    // accept: there is no third request shape for a plain "no".
    const res = await postDecline('dddddddd-dddd-4ddd-8ddd-ddddddddddd3', {
      reason: 'whatever',
    });

    expect(res.status).toBe(200);
  });
});

/**
 * @module tests/unit/domains/timesheet/routes/timesheetRoutes
 *
 * The flat `/timesheets/:id` router serves FOUR routes at ONE resource id
 * under TWO different permissions, and keeping them apart is the whole
 * payroll audit-trail rule:
 *
 *   GET  /:id          service gate, getReadableTimesheet (a REMOVED member
 *                      may read) — NO ownership middleware, see below
 *   POST /:id/approve  ownership middleware -> getOwnedTimesheet (ACTIVE only)
 *   POST /:id/query    same
 *   POST /:id/reopen   same
 *
 * WHY THE READ HAS NO OWNERSHIP MIDDLEWARE, pinned here because it is not
 * obvious from the route file alone: `makeOwnershipValidator` caches its
 * lookup result under `(userId, resourceId)` with NO lookup identity in the
 * key. Give the read its own, wider lookup there and one permitted GET leaves
 * a positive cache entry that every action on the same id then reuses —
 * skipping `getOwnedTimesheet` and letting a removed parent approve a week.
 * The sequence test below is the regression pin for exactly that.
 *
 * A service-level test cannot prove any of this wiring; swapping the guards
 * would leave every service test green. So this mounts the REAL router with
 * the two lookups stubbed to opposite answers — readable resolves, owned
 * rejects, which is the state a removed member is actually in.
 *
 * Approach copied from `householdTimesheetRoutes.test.ts`: a real `express()`
 * app, the real router, the real `validate()`/`errorHandler`, driven with
 * `fetch`. Only `requireAuth` and the two timesheet services are stubbed.
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

/**
 * A distinct id per case, because `makeOwnershipValidator` also caches
 * NEGATIVE results by `(userId, resourceId)`: reusing one id would let the
 * first 404 short-circuit the rest and stop proving anything.
 */
const TIMESHEET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTION_IDS = {
  approve: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  query: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  reopen: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
} as const;
const SEQUENCE_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4';
const AUTH_USER_ID = 'removed-parent-1';

let server: import('node:http').Server;
let baseUrl: string;

let getWeekWithEarningsMock: ReturnType<typeof mock>;
let getOwnedTimesheetMock: ReturnType<typeof mock>;
let approveMock: ReturnType<typeof mock>;

beforeAll(async () => {
  // The removed-member state: the read gate (inside getWeekWithEarnings) lets
  // them through, the active-only ownership lookup does not.
  getWeekWithEarningsMock = mock(async (..._args: unknown[]) => ({
    id: TIMESHEET_ID,
  }));
  getOwnedTimesheetMock = mock(async (..._args: unknown[]) => {
    const { TimesheetNotFoundError } = await import(
      '../../../../../src/domains/timesheet/errors/timesheetErrors'
    );
    throw new TimesheetNotFoundError(TIMESHEET_ID);
  });
  approveMock = mock(async (..._args: unknown[]) => ({ id: TIMESHEET_ID }));

  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { id: AUTH_USER_ID };
      next();
    },
    validateSupabaseToken: mock((_req: any, _res: any, next: any) => next()),
    extractBearerToken: mock(() => null),
  }));

  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetQueryService',
    () => ({
      timesheetQueryService: {
        getOwnedTimesheet: (...args: unknown[]) =>
          getOwnedTimesheetMock(...args),
        getWeekWithEarnings: (...args: unknown[]) =>
          getWeekWithEarningsMock(...args),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetCommandService',
    () => ({
      timesheetCommandService: {
        approve: (...args: unknown[]) => approveMock(...args),
        query: (...args: unknown[]) => approveMock(...args),
        reopen: (...args: unknown[]) => approveMock(...args),
      },
    })
  );

  // Dynamic imports AFTER every mock.module() (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const timesheetRoutes = (
    await import('../../../../../src/domains/timesheet/routes/timesheetRoutes')
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
  app.use('/timesheets', timesheetRoutes);
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
  getWeekWithEarningsMock.mockClear();
  getOwnedTimesheetMock.mockClear();
  approveMock.mockClear();
});

const ACTION_BODIES = {
  approve: {},
  query: { note: 'Tuesday looks long' },
  reopen: { reason: 'Missed an hour' },
} as const;

function postAction(
  action: keyof typeof ACTION_IDS,
  timesheetId: string
): Promise<Response> {
  return fetch(`${baseUrl}/timesheets/${timesheetId}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ACTION_BODIES[action]),
  });
}

describe('GET /timesheets/:id — the read reaches the service gate, unguarded by middleware', () => {
  it('serves the week for a removed member', async () => {
    const res = await fetch(`${baseUrl}/timesheets/${TIMESHEET_ID}`);

    expect(res.status).toBe(200);
    expect(getWeekWithEarningsMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      TIMESHEET_ID
    );
    // The stricter action lookup is never consulted — and, crucially, never
    // fed a cache entry (see the sequence test below).
    expect(getOwnedTimesheetMock).not.toHaveBeenCalled();
  });

  it('still rejects a non-uuid id with 400 before the controller runs', async () => {
    const res = await fetch(`${baseUrl}/timesheets/not-a-uuid`);

    expect(res.status).toBe(400);
    expect(getWeekWithEarningsMock).not.toHaveBeenCalled();
  });
});

describe('POST /timesheets/:id/{approve,query,reopen} — actions stay ACTIVE-only', () => {
  for (const action of ['approve', 'query', 'reopen'] as const) {
    it(`404s ${action} for a removed member, and never reaches the command service`, async () => {
      const res = await postAction(action, ACTION_IDS[action]);

      expect(res.status).toBe(404);
      expect(getOwnedTimesheetMock).toHaveBeenCalledWith(
        AUTH_USER_ID,
        ACTION_IDS[action]
      );
      expect(approveMock).not.toHaveBeenCalled();
    });
  }
});

describe('the read must not prime the ownership cache for the actions', () => {
  it('a permitted GET followed by approve on the SAME id still 404s', async () => {
    // The regression this pins: while GET /:id ran through
    // makeOwnershipValidator with the wider read lookup, this sequence
    // returned 200 and approved a week for a removed parent — the positive
    // entry the GET cached under (userId, resourceId) was reused verbatim.
    const read = await fetch(`${baseUrl}/timesheets/${SEQUENCE_ID}`);
    expect(read.status).toBe(200);

    const approved = await postAction('approve', SEQUENCE_ID);

    expect(approved.status).toBe(404);
    expect(getOwnedTimesheetMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      SEQUENCE_ID
    );
    expect(approveMock).not.toHaveBeenCalled();
  });
});

/**
 * @module tests/unit/domains/timesheet/routes/timesheetRoutes
 *
 * The flat `/timesheets/:id` router serves SEVEN routes at ONE resource id
 * under TWO different permissions, and keeping them apart is the whole
 * payroll audit-trail rule:
 *
 *   GET  /:id                 service gate, getReadableTimesheet (a REMOVED
 *                             member may read) — NO ownership middleware
 *   GET  /:id/export.csv      same wide gate, same reason
 *   GET  /:id/thread          same wide gate — D-18's whole point is that a
 *                             nanny can READ what was said about her pay
 *   POST /:id/approve         ownership middleware -> getOwnedTimesheet
 *                             (ACTIVE only)
 *   POST /:id/query           same
 *   POST /:id/reopen          same
 *   POST /:id/thread          same — speaking needs an active membership
 *   POST /:id/withdraw-query  same
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
const THREAD_READ_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc7';
const THREAD_POST_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc8';
const WITHDRAW_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9';
const AUTH_USER_ID = 'removed-parent-1';
const VOID_ENTRY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const VOID_REFUSED_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';

let server: import('node:http').Server;
let baseUrl: string;

let getWeekWithEarningsMock: ReturnType<typeof mock>;
let getOwnedTimesheetMock: ReturnType<typeof mock>;
let getOwnedTimeEntryMock: ReturnType<typeof mock>;
let approveMock: ReturnType<typeof mock>;
let voidEntryMock: ReturnType<typeof mock>;
let exportWeekCsvMock: ReturnType<typeof mock>;
let getThreadMock: ReturnType<typeof mock>;

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
  getOwnedTimeEntryMock = mock(async (..._args: unknown[]) => ({
    id: VOID_ENTRY_ID,
    household_id: 'h1',
    carer_id: AUTH_USER_ID,
    status: 'submitted',
  }));
  approveMock = mock(async (..._args: unknown[]) => ({ id: TIMESHEET_ID }));
  voidEntryMock = mock(async (..._args: unknown[]) => ({
    id: VOID_ENTRY_ID,
    status: 'voided',
  }));
  getThreadMock = mock(async (..._args: unknown[]) => ({ messages: [] }));
  exportWeekCsvMock = mock(async (..._args: unknown[]) => ({
    filename: 'steadily-week-2026-08-03-nia-rowe.csv',
    csv: 'date,description,kind,minutes,rate_minor,amount_minor,currency\r\n',
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
    '../../../../../src/domains/timesheet/services/timesheetQueryService',
    () => ({
      timesheetQueryService: {
        getOwnedTimesheet: (...args: unknown[]) =>
          getOwnedTimesheetMock(...args),
        getOwnedTimeEntry: (...args: unknown[]) =>
          getOwnedTimeEntryMock(...args),
        getWeekWithEarnings: (...args: unknown[]) =>
          getWeekWithEarningsMock(...args),
        exportWeekCsv: (...args: unknown[]) => exportWeekCsvMock(...args),
        getThread: (...args: unknown[]) => getThreadMock(...args),
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
        addThreadMessage: (...args: unknown[]) => approveMock(...args),
        withdrawQuery: (...args: unknown[]) => approveMock(...args),
        voidEntry: (...args: unknown[]) => voidEntryMock(...args),
      },
    })
  );

  // Dynamic imports AFTER every mock.module() (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const timesheetRoutes = (
    await import('../../../../../src/domains/timesheet/routes/timesheetRoutes')
  ).default;
  const timeEntryRoutes = (
    await import('../../../../../src/domains/timesheet/routes/timeEntryRoutes')
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
  app.use('/time-entries', timeEntryRoutes);
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
  getOwnedTimeEntryMock.mockClear();
  approveMock.mockClear();
  voidEntryMock.mockClear();
  exportWeekCsvMock.mockClear();
  getThreadMock.mockClear();
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

describe('GET /timesheets/:id/export.csv — the payroll handoff, same gate as the read', () => {
  const EXPORT_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5';

  it('serves the CSV with download headers for a removed member', async () => {
    const res = await fetch(`${baseUrl}/timesheets/${EXPORT_ID}/export.csv`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="steadily-week-2026-08-03-nia-rowe.csv"'
    );
    expect(await res.text()).toBe(
      'date,description,kind,minutes,rate_minor,amount_minor,currency\r\n'
    );
    expect(exportWeekCsvMock).toHaveBeenCalledWith(AUTH_USER_ID, EXPORT_ID);
    // Same reason as the week read: the ACTIVE-only lookup must never be
    // consulted here, or its (userId, resourceId) cache entry leaks into the
    // actions.
    expect(getOwnedTimesheetMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id with 400 before the controller runs', async () => {
    const res = await fetch(`${baseUrl}/timesheets/not-a-uuid/export.csv`);

    expect(res.status).toBe(400);
    expect(exportWeekCsvMock).not.toHaveBeenCalled();
  });

  it('surfaces a service refusal as its own status, not as a CSV body', async () => {
    const refusedId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc6';
    exportWeekCsvMock.mockImplementationOnce(async () => {
      const { TimesheetNotExportableError } = await import(
        '../../../../../src/domains/timesheet/errors/timesheetErrors'
      );
      throw new TimesheetNotExportableError(
        refusedId,
        'submitted',
        'not_approved'
      );
    });

    const res = await fetch(`${baseUrl}/timesheets/${refusedId}/export.csv`);

    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
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

describe('DELETE /time-entries/:id — void uses authWithOwnership', () => {
  it("voids the caller's own entry after the ownership lookup", async () => {
    const res = await fetch(`${baseUrl}/time-entries/${VOID_ENTRY_ID}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(getOwnedTimeEntryMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      VOID_ENTRY_ID
    );
    expect(voidEntryMock).toHaveBeenCalledWith(AUTH_USER_ID, VOID_ENTRY_ID);
    const body = await res.json();
    expect(body.data).toEqual({
      time_entry: { id: VOID_ENTRY_ID, status: 'voided' },
    });
  });

  it('404s when the ownership lookup rejects the caller before void runs', async () => {
    getOwnedTimeEntryMock.mockImplementationOnce(async () => {
      const { TimeEntryNotFoundError } = await import(
        '../../../../../src/domains/timesheet/errors/timesheetErrors'
      );
      throw new TimeEntryNotFoundError(VOID_REFUSED_ID);
    });

    const res = await fetch(`${baseUrl}/time-entries/${VOID_REFUSED_ID}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
    expect(getOwnedTimeEntryMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      VOID_REFUSED_ID
    );
    expect(voidEntryMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id with 400 before the ownership lookup runs', async () => {
    const res = await fetch(`${baseUrl}/time-entries/not-a-uuid`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(400);
    expect(getOwnedTimeEntryMock).not.toHaveBeenCalled();
    expect(voidEntryMock).not.toHaveBeenCalled();
  });
});

/**
 * The adjustment rides POST /:id/approve as a BODY. Adding body validation to
 * a route that previously validated none is the exact shape of change that
 * can quietly break two things at once, so both are pinned here:
 *
 *  - the ownership middleware is still in front of it (GOLDEN-FIXES #31 — a
 *    removed parent must still 404, body or no body);
 *  - a legacy client that posts approve with NO body at all still succeeds.
 *    Express 5's body-parser leaves `req.body` UNDEFINED for a bodyless POST,
 *    not `{}`, so a bare `z.object({...})` here would 400 every shipped app.
 */
describe('POST /timesheets/:id/approve — the adjustment body', () => {
  const ADJ_IDS = {
    removed: 'cccccccc-cccc-4ccc-8ccc-ccccccccccd1',
    allowed: 'cccccccc-cccc-4ccc-8ccc-ccccccccccd2',
    invalid: 'cccccccc-cccc-4ccc-8ccc-ccccccccccd3',
    bodyless: 'cccccccc-cccc-4ccc-8ccc-ccccccccccd4',
    zero: 'cccccccc-cccc-4ccc-8ccc-ccccccccccd5',
  } as const;

  function approveWithBody(
    timesheetId: string,
    body: unknown
  ): Promise<Response> {
    return fetch(`${baseUrl}/timesheets/${timesheetId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('still 404s a removed parent who posts an adjustment', async () => {
    const res = await approveWithBody(ADJ_IDS.removed, {
      adjustment: { amount_minor: -2000, note: 'Advance repaid' },
    });

    expect(res.status).toBe(404);
    expect(getOwnedTimesheetMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      ADJ_IDS.removed
    );
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('passes the validated adjustment through to the command service', async () => {
    getOwnedTimesheetMock.mockImplementationOnce(async () => ({
      id: ADJ_IDS.allowed,
    }));

    const res = await approveWithBody(ADJ_IDS.allowed, {
      adjustment: { amount_minor: -2000, note: '  Advance repaid  ' },
    });

    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(AUTH_USER_ID, ADJ_IDS.allowed, {
      // Trimmed on the way in by the schema, before the service ever sees it.
      adjustment: { amount_minor: -2000, note: 'Advance repaid' },
    });
  });

  it('400s a malformed adjustment before the command service runs', async () => {
    getOwnedTimesheetMock.mockImplementationOnce(async () => ({
      id: ADJ_IDS.invalid,
    }));

    const res = await approveWithBody(ADJ_IDS.invalid, {
      adjustment: { amount_minor: -2000, note: '' },
    });

    expect(res.status).toBe(400);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('400s a zero adjustment — an adjustment of nothing is a client bug', async () => {
    getOwnedTimesheetMock.mockImplementationOnce(async () => ({
      id: ADJ_IDS.zero,
    }));

    const res = await approveWithBody(ADJ_IDS.zero, {
      adjustment: { amount_minor: 0, note: 'Nothing' },
    });

    expect(res.status).toBe(400);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('accepts a bodyless approve — every client shipped before this feature', async () => {
    getOwnedTimesheetMock.mockImplementationOnce(async () => ({
      id: ADJ_IDS.bodyless,
    }));

    const res = await fetch(
      `${baseUrl}/timesheets/${ADJ_IDS.bodyless}/approve`,
      { method: 'POST' }
    );

    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      ADJ_IDS.bodyless,
      {}
    );
  });
});

/**
 * The week thread (D-18 / D-19 / D-46) inherits the SAME two-permissions
 * split this file exists to protect, and gets it wrong in the most tempting
 * possible way if nobody pins it: the READ is the wide gate (the whole point
 * of D-18 is that a nanny — including a departed one — can read what was said
 * about her pay), the WRITES are ACTIVE-member-only. Wiring the read's lookup
 * into `makeOwnershipValidator` to "match" the writes would poison the shared
 * `(userId, resourceId)` cache for `/approve` (GOLDEN-FIXES #32).
 */
describe('GET /timesheets/:id/thread — the wide read gate, no ownership middleware', () => {
  it('serves the thread for a removed member and never consults the action lookup', async () => {
    const res = await fetch(`${baseUrl}/timesheets/${THREAD_READ_ID}/thread`);

    expect(res.status).toBe(200);
    expect(getThreadMock).toHaveBeenCalledWith(AUTH_USER_ID, THREAD_READ_ID);
    expect(getOwnedTimesheetMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id with 400 before the controller runs', async () => {
    const res = await fetch(`${baseUrl}/timesheets/not-a-uuid/thread`);

    expect(res.status).toBe(400);
    expect(getThreadMock).not.toHaveBeenCalled();
  });
});

describe('POST /timesheets/:id/thread — writing stays ACTIVE-only', () => {
  it('404s for a removed member and never reaches the command service', async () => {
    const res = await fetch(`${baseUrl}/timesheets/${THREAD_POST_ID}/thread`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'I stayed late.' }),
    });

    expect(res.status).toBe(404);
    expect(getOwnedTimesheetMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      THREAD_POST_ID
    );
    expect(approveMock).not.toHaveBeenCalled();
  });

  // Ownership sits AHEAD of body validation, matching /approve, /query and
  // /reopen — a stranger learns "no such week", never "your message was
  // blank", which would confirm the week exists.
  it('answers a blank message from a non-member with the same opaque 404, not a 400', async () => {
    const res = await fetch(
      `${baseUrl}/timesheets/cccccccc-cccc-4ccc-8ccc-cccccccccca1/thread`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '   ' }),
      }
    );

    expect(res.status).toBe(404);
    expect(approveMock).not.toHaveBeenCalled();
  });
});

describe('POST /timesheets/:id/withdraw-query — parent exit from queried (D-19)', () => {
  it('404s for a removed member and never reaches the command service', async () => {
    const res = await fetch(
      `${baseUrl}/timesheets/${WITHDRAW_ID}/withdraw-query`,
      { method: 'POST' }
    );

    expect(res.status).toBe(404);
    expect(getOwnedTimesheetMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      WITHDRAW_ID
    );
    expect(approveMock).not.toHaveBeenCalled();
  });
});

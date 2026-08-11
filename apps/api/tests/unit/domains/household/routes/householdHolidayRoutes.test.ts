/**
 * @module tests/unit/domains/household/routes/householdHolidayRoutes
 *
 * The holiday PUT is the only write in this domain whose body is a LIST, and
 * the two refusals that matter live entirely in the shared wire schema — an
 * unresolvable `holiday_key` (a toggle that would price nothing, forever) and
 * a repeated one (two contradictory instructions about the same day). Neither
 * is visible from a service test, because a service test hands the service a
 * body that already parsed.
 *
 * Same approach as `householdRoutes.test.ts`: a real `express()` app, the REAL
 * router mounted where `routes/index.ts` mounts it, the REAL presets,
 * `validate()` and `errorHandler`. Only auth and the two services are stubbed.
 *
 * WHAT THIS PROVES:
 *  - Both routes exist at `/households/:householdId/holidays` and answer with
 *    the `{ household_holidays: [...] }` envelope.
 *  - A stranger gets 404 from the ownership preset BEFORE either service.
 *  - An unknown key, a duplicate key, and an empty list are each 400'd before
 *    the command service.
 *
 * WHAT THIS DOES NOT PROVE:
 *  - The parent-only role gate, which lives in the mocked command service (see
 *    `householdHolidays.test.ts`).
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
const OTHER_HOUSEHOLD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_HOUSEHOLD_ID_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const AUTH_USER_ID = 'parent-1';

// BOTH timestamp serialisations across the fixtures (GOLDEN-FIXES #25).
const ROWS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    household_id: HOUSEHOLD_ID,
    holiday_key: 'independence_day',
    observed: true,
    created_at: '2026-08-11T09:00:00+00:00',
    updated_at: '2026-08-11T09:00:00+00:00',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    household_id: HOUSEHOLD_ID,
    holiday_key: 'labor_day',
    observed: false,
    created_at: '2026-08-11T09:00:00.000Z',
    updated_at: '2026-08-11T09:00:00.000Z',
  },
];

let server: import('node:http').Server;
let baseUrl: string;
let listHolidaysMock: ReturnType<typeof mock>;
let setHolidaysMock: ReturnType<typeof mock>;
let getOwnedMock: ReturnType<typeof mock>;

function put(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  listHolidaysMock = mock(async (..._args: unknown[]) => ROWS);
  setHolidaysMock = mock(async (..._args: unknown[]) => ROWS);
  getOwnedMock = mock(async (_userId: string, householdId: string) => ({
    id: householdId,
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
    '../../../../../src/domains/household/services/householdQueryService',
    () => ({
      householdQueryService: {
        getOwned: (...args: any[]) => getOwnedMock(...args),
        listHolidays: (...args: any[]) => listHolidaysMock(...args),
        listForUser: mock(async () => []),
        listPastForUser: mock(async () => []),
        listMembers: mock(async () => []),
        previewInvite: mock(async () => ({})),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/household/services/householdCommandService',
    () => ({
      householdCommandService: {
        setHolidays: (...args: any[]) => setHolidaysMock(...args),
        create: mock(async () => ({})),
        update: mock(async () => ({})),
        createInvite: mock(async () => ({})),
        removeMember: mock(async () => ({})),
        revokeInvite: mock(async () => ({})),
        redeemInvite: mock(async () => ({})),
        leave: mock(async () => ({})),
      },
    })
  );

  // Dynamic imports AFTER every mock.module() (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const householdRoutes = (
    await import('../../../../../src/domains/household/routes/householdRoutes')
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
  app.use('/households', householdRoutes);
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
  listHolidaysMock.mockClear();
  setHolidaysMock.mockClear();
});

describe('GET /households/:householdId/holidays', () => {
  it('answers with the household_holidays envelope', async () => {
    const res = await fetch(`${baseUrl}/households/${HOUSEHOLD_ID}/holidays`);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.household_holidays).toEqual(ROWS);
    expect(listHolidaysMock).toHaveBeenCalledWith(AUTH_USER_ID, HOUSEHOLD_ID);
  });

  it('404s a household the caller is not a member of, BEFORE the service', async () => {
    getOwnedMock.mockImplementationOnce(async () => {
      const { HouseholdNotFoundError } = await import(
        '../../../../../src/domains/household/errors/householdErrors'
      );
      throw new HouseholdNotFoundError(OTHER_HOUSEHOLD_ID);
    });

    const res = await fetch(
      `${baseUrl}/households/${OTHER_HOUSEHOLD_ID}/holidays`
    );

    expect(res.status).toBe(404);
    expect(listHolidaysMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid householdId with 400', async () => {
    const res = await fetch(`${baseUrl}/households/not-a-uuid/holidays`);
    expect(res.status).toBe(400);
    expect(listHolidaysMock).not.toHaveBeenCalled();
  });
});

describe('PUT /households/:householdId/holidays', () => {
  it('passes the toggle list through and answers with the full post-write list', async () => {
    const res = await put(`/households/${HOUSEHOLD_ID}/holidays`, {
      holidays: [{ holiday_key: 'labor_day', observed: true }],
    });
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.household_holidays).toEqual(ROWS);
    expect(setHolidaysMock).toHaveBeenCalledWith(AUTH_USER_ID, HOUSEHOLD_ID, {
      holidays: [{ holiday_key: 'labor_day', observed: true }],
    });
  });

  it('400s an unknown holiday_key at the wire — a toggle that prices nothing', async () => {
    const res = await put(`/households/${HOUSEHOLD_ID}/holidays`, {
      holidays: [{ holiday_key: 'st_swithins_day', observed: true }],
    });

    expect(res.status).toBe(400);
    expect(setHolidaysMock).not.toHaveBeenCalled();
  });

  it('400s a duplicate holiday_key — two contradictory answers for one day', async () => {
    const res = await put(`/households/${HOUSEHOLD_ID}/holidays`, {
      holidays: [
        { holiday_key: 'labor_day', observed: true },
        { holiday_key: 'labor_day', observed: false },
      ],
    });

    expect(res.status).toBe(400);
    expect(setHolidaysMock).not.toHaveBeenCalled();
  });

  it('400s an empty list — a save that says nothing is a bug, not a no-op', async () => {
    const res = await put(`/households/${HOUSEHOLD_ID}/holidays`, {
      holidays: [],
    });

    expect(res.status).toBe(400);
    expect(setHolidaysMock).not.toHaveBeenCalled();
  });

  it('400s a missing body', async () => {
    const res = await put(`/households/${HOUSEHOLD_ID}/holidays`, {});
    expect(res.status).toBe(400);
    expect(setHolidaysMock).not.toHaveBeenCalled();
  });

  it('404s a stranger BEFORE the command service', async () => {
    getOwnedMock.mockImplementationOnce(async () => {
      const { HouseholdNotFoundError } = await import(
        '../../../../../src/domains/household/errors/householdErrors'
      );
      throw new HouseholdNotFoundError(OTHER_HOUSEHOLD_ID_2);
    });

    const res = await put(`/households/${OTHER_HOUSEHOLD_ID_2}/holidays`, {
      holidays: [{ holiday_key: 'labor_day', observed: true }],
    });

    expect(res.status).toBe(404);
    expect(setHolidaysMock).not.toHaveBeenCalled();
  });
});

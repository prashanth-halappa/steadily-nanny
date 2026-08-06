/**
 * @module tests/unit/domains/timesheet/routes/householdTimesheetRoutes
 *
 * F-B10-3: no timesheet route had a mounted-router test — every other test in
 * this domain exercises the controller or service in isolation, which never
 * proves the actual Express wiring (the `authWithValidation` preset, the real
 * Zod query validation, the real `errorHandler`) behaves as the route files
 * declare. This is the money path: a `carer_id` filter that validates in the
 * service but never survives the HTTP layer silently sums two carers' hours.
 *
 * Both household-nested routers live here because they are the same surface —
 * `/households/:householdId/time-entries` and
 * `/households/:householdId/timesheets` — and both gained the same optional
 * carer filter. Approach copied from
 * `tests/unit/domains/pay/routes/payArrangementRoutes.test.ts`: a real
 * `express()` app, the REAL routers mounted at the exact paths
 * `routes/index.ts` uses, the REAL `validate()`/`errorHandler`, and a real
 * listening server driven with `fetch`. Only the auth boundary
 * (`requireAuth`, imported by `middlewares/presets.ts`) and the query service
 * are stubbed.
 *
 * WHAT THIS PROVES:
 *  - `carer_id` is validated as a uuid and rejected with a 400 BEFORE the
 *    query service is called, on both routes.
 *  - A valid `carer_id` actually reaches the service as the carer-scoping
 *    argument U12 (mobile) depends on.
 *  - Omitting `carer_id` still reaches the service with `undefined` — the
 *    every-carer behaviour these endpoints have always had.
 *  - An unknown query param is STRIPPED, not rejected: adding query
 *    validation to the timesheets route does not 400 a request that used to
 *    succeed.
 *
 * WHAT THIS DOES NOT PROVE:
 *  - That the full `/api/v1` router mounts these at those paths in the real
 *    app — mounting it here would transitively import every domain. The
 *    static-source check at the bottom is textual evidence the mount strings
 *    have not drifted, same compromise as the pay-domain test.
 *  - Anything about real Supabase JWT verification (`requireAuth` is stubbed)
 *    or about membership authorization (it lives in the mocked service).
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

// Real RFC-4122 v4-shaped uuids — `z.uuid()` validates the version and
// variant nibbles, so an all-same-digit string is genuinely rejected.
const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARER_ID = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const AUTH_USER_ID = 'parent-1';

let server: import('node:http').Server;
let baseUrl: string;

let listForHouseholdWeekMock: ReturnType<typeof mock>;
let listTimesheetsForHouseholdMock: ReturnType<typeof mock>;

beforeAll(async () => {
  listForHouseholdWeekMock = mock(async (..._args: unknown[]) => [
    { id: 't1' },
  ]);
  listTimesheetsForHouseholdMock = mock(async (..._args: unknown[]) => [
    { id: 'ts1' },
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
    '../../../../../src/domains/timesheet/services/timesheetQueryService',
    () => ({
      timesheetQueryService: {
        listForHouseholdWeek: (...args: unknown[]) =>
          listForHouseholdWeekMock(...args),
        listTimesheetsForHousehold: (...args: unknown[]) =>
          listTimesheetsForHouseholdMock(...args),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetCommandService',
    () => ({ timesheetCommandService: {} })
  );

  // Dynamic imports AFTER every mock.module() (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const householdTimeEntryRoutes = (
    await import(
      '../../../../../src/domains/timesheet/routes/householdTimeEntryRoutes'
    )
  ).default;
  const householdTimesheetRoutes = (
    await import(
      '../../../../../src/domains/timesheet/routes/householdTimesheetRoutes'
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
  app.use('/households/:householdId/time-entries', householdTimeEntryRoutes);
  app.use('/households/:householdId/timesheets', householdTimesheetRoutes);
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
  listForHouseholdWeekMock.mockClear();
  listTimesheetsForHouseholdMock.mockClear();
});

describe('GET /households/:householdId/time-entries — carer filter (F-B1-3)', () => {
  it('passes a valid carer_id through to the query service', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/time-entries?week_start=2026-08-03&carer_id=${CARER_ID}`
    );

    expect(res.status).toBe(200);
    expect(listForHouseholdWeekMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      HOUSEHOLD_ID,
      '2026-08-03',
      CARER_ID
    );
  });

  it('rejects a non-uuid carer_id with 400 BEFORE the query service is called', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/time-entries?carer_id=not-a-uuid`
    );

    expect(res.status).toBe(400);
    expect(listForHouseholdWeekMock).not.toHaveBeenCalled();
  });

  it('still serves every carer when carer_id is omitted', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/time-entries?week_start=2026-08-03`
    );

    expect(res.status).toBe(200);
    expect(listForHouseholdWeekMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      HOUSEHOLD_ID,
      '2026-08-03',
      undefined
    );
  });
});

describe('GET /households/:householdId/timesheets — carer filter (F-B1-3)', () => {
  it('passes a valid carer_id through to the query service', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/timesheets?carer_id=${CARER_ID}`
    );

    expect(res.status).toBe(200);
    expect(listTimesheetsForHouseholdMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      HOUSEHOLD_ID,
      CARER_ID
    );
  });

  it('rejects a non-uuid carer_id with 400 BEFORE the query service is called', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/timesheets?carer_id=not-a-uuid`
    );

    expect(res.status).toBe(400);
    expect(listTimesheetsForHouseholdMock).not.toHaveBeenCalled();
  });

  it('still serves every carer when carer_id is omitted', async () => {
    const res = await fetch(`${baseUrl}/households/${HOUSEHOLD_ID}/timesheets`);

    expect(res.status).toBe(200);
    expect(listTimesheetsForHouseholdMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      HOUSEHOLD_ID,
      undefined
    );
  });

  it('STRIPS an unknown query param rather than 400ing a request that used to succeed', async () => {
    // Adding query validation to this route is a new surface. Zod objects
    // strip unknown keys by default (not `.strict()`), so a client sending
    // anything extra keeps working exactly as it did before.
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/timesheets?sort=desc&page=2`
    );

    expect(res.status).toBe(200);
    expect(listTimesheetsForHouseholdMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      HOUSEHOLD_ID,
      undefined
    );
  });

  it('rejects a non-uuid householdId with 400', async () => {
    const res = await fetch(`${baseUrl}/households/not-a-uuid/timesheets`);

    expect(res.status).toBe(400);
    expect(listTimesheetsForHouseholdMock).not.toHaveBeenCalled();
  });
});

describe('mount paths (static evidence only — see the file header)', () => {
  it('routes/index.ts mounts both routers at the exact paths exercised above', () => {
    const indexSource = readFileSync(
      join(__dirname, '../../../../../src/routes/index.ts'),
      'utf-8'
    );
    expect(indexSource).toContain("'/households/:householdId/time-entries'");
    expect(indexSource).toContain("'/households/:householdId/timesheets'");
  });
});

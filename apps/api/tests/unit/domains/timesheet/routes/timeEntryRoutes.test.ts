/**
 * @module tests/unit/domains/timesheet/routes/timeEntryRoutes
 *
 * The WIRE SHAPE of the terms block, pinned where the mobile client reads it.
 *
 * A service test proves `TermsNotAgreedError` is thrown; it cannot prove what
 * reaches the phone. The blocked clock-in card (direction doc §3) switches on
 * `error.metadata.reason === 'TERMS_NOT_AGREED'`
 * (`timeEntryMutationUtils.ts`), so the three things asserted here — 409, the
 * generic `CONFLICT` code, and the reason inside `metadata` — are a contract
 * between two apps, not an implementation detail. `BaseError.toClientJSON`
 * only ships `metadata` for 4xx, which is exactly why the error is a
 * `ConflictError` and not a 500-shaped one.
 *
 * Approach copied from `timesheetRoutes.test.ts`: a real `express()` app, the
 * real router, the real `validate()` and `errorHandler`, driven with `fetch`.
 * Only `requireAuth` and the command service are stubbed.
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
const AUTH_USER_ID = 'carer-1';
const ENTRY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let server: import('node:http').Server;
let baseUrl: string;
let clockInMock: ReturnType<typeof mock>;
let retroMock: ReturnType<typeof mock>;
let clockOutMock: ReturnType<typeof mock>;

beforeAll(async () => {
  const refuse = async (..._args: unknown[]) => {
    const { TermsNotAgreedError } = await import(
      '../../../../../src/domains/pay/errors/payErrors'
    );
    throw new TermsNotAgreedError(HOUSEHOLD_ID, AUTH_USER_ID);
  };
  clockInMock = mock(refuse);
  retroMock = mock(refuse);
  clockOutMock = mock(async () => ({ id: 'te-1', status: 'submitted' }));

  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { id: AUTH_USER_ID };
      next();
    },
    validateSupabaseToken: mock(
      (_req: unknown, _res: unknown, next: () => void) => next()
    ),
    extractBearerToken: mock(() => null),
  }));
  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetCommandService',
    () => ({
      timesheetCommandService: {
        clockIn: (...args: unknown[]) => clockInMock(...args),
        createRetroactiveEntry: (...args: unknown[]) => retroMock(...args),
        clockOut: (...args: unknown[]) => clockOutMock(...args),
      },
    })
  );

  // The route's ownership lookup, refusing exactly as it does for a member
  // whose household lost its last writer while she was on shift.
  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetQueryService',
    () => ({
      timesheetQueryService: {
        getOwnedTimeEntry: mock(async (_userId: string, id: string) => {
          const { TimeEntryNotFoundError } = await import(
            '../../../../../src/domains/timesheet/errors/timesheetErrors'
          );
          throw new TimeEntryNotFoundError(id);
        }),
      },
    })
  );

  // Dynamic imports AFTER every mock.module() (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
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
  clockInMock.mockClear();
  retroMock.mockClear();
  clockOutMock.mockClear();
});

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/time-entries/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /time-entries/clock-in — the terms block on the wire', () => {
  it('is a 409 the client can act on, not a bare 403', async () => {
    const res = await post('clock-in', { household_id: HOUSEHOLD_ID });

    expect(res.status).toBe(409);
    expect(clockInMock).toHaveBeenCalledWith(AUTH_USER_ID, {
      household_id: HOUSEHOLD_ID,
    });
  });

  it('carries error.code CONFLICT and error.metadata.reason TERMS_NOT_AGREED', async () => {
    const res = await post('clock-in', { household_id: HOUSEHOLD_ID });
    const body = await res.json();

    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.metadata.reason).toBe('TERMS_NOT_AGREED');
  });

  it('says the card sentence rather than a code', async () => {
    const res = await post('clock-in', { household_id: HOUSEHOLD_ID });
    const body = await res.json();

    expect(body.error.message).toBe('Clock-in opens when terms are agreed.');
  });
});

describe('POST /time-entries/retroactive — the same refusal, same shape', () => {
  it('surfaces 409 + TERMS_NOT_AGREED for "Add missed hours" too', async () => {
    const res = await post('retroactive', {
      household_id: HOUSEHOLD_ID,
      clock_in_at: '2026-08-14T21:00:00.000Z',
      clock_out_at: '2026-08-15T01:00:00.000Z',
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.metadata.reason).toBe('TERMS_NOT_AGREED');
  });
});

describe('POST /time-entries/:id/clock-out — the one write a removed member keeps', () => {
  // The strict ownership middleware would 404 her at the door, before the
  // service's own gate ever ran. It is off this route deliberately, and the
  // service gates instead — the same shape GOLDEN-FIXES #32 prescribes for
  // `GET /timesheets/:id`, and for the same reason: two routes over one id
  // with two different permissions must never share the relationship cache.
  it('reaches the service even when the strict ownership lookup refuses', async () => {
    const res = await post(`${ENTRY_ID}/clock-out`, {});

    expect(res.status).toBe(200);
    expect(clockOutMock).toHaveBeenCalled();
  });
});

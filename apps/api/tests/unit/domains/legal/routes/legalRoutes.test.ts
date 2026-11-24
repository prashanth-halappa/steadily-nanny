/**
 * Route-level tests for `/legal/acceptance` — real express app, real router,
 * real `validate()` and `errorHandler`, driven with `fetch`. Only `requireAuth`
 * and `legalService` are stubbed.
 *
 * @module tests/unit/domains/legal/routes/legalRoutes
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
import {
  CURRENT_LEGAL_VERSION,
  type LegalStatus,
} from '@steadily-nanny/shared-types';
import type { NextFunction, Request, Response } from 'express';

const AUTH_USER_ID = 'legal-route-user-1';

const PENDING_STATUS: LegalStatus = {
  currentVersion: CURRENT_LEGAL_VERSION,
  acceptedVersion: null,
  acceptedAt: null,
  needsAcceptance: true,
};

const ACCEPTED_STATUS: LegalStatus = {
  currentVersion: CURRENT_LEGAL_VERSION,
  acceptedVersion: CURRENT_LEGAL_VERSION,
  acceptedAt: '2026-11-24T12:00:00.000Z',
  needsAcceptance: false,
};

let server: import('node:http').Server;
let baseUrl: string;

let getStatusMock: ReturnType<typeof mock>;
let acceptMock: ReturnType<typeof mock>;

beforeAll(async () => {
  getStatusMock = mock(async (..._args: unknown[]) => PENDING_STATUS);
  acceptMock = mock(async (..._args: unknown[]) => ACCEPTED_STATUS);

  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: AUTH_USER_ID } as Request['user'];
      next();
    },
    validateSession: mock((_req: Request, _res: Response, next: NextFunction) =>
      next()
    ),
    resolveSessionUser: mock(async () => null),
  }));

  mock.module('../../../../../src/domains/legal/services/legalService', () => ({
    legalService: {
      getStatus: (...args: unknown[]) => getStatusMock(...args),
      accept: (...args: unknown[]) => acceptMock(...args),
    },
  }));

  // Dynamic imports AFTER every mock.module() (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const legalRoutes = (
    await import('../../../../../src/domains/legal/routes/legalRoutes')
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
  app.use('/legal', legalRoutes);
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
  getStatusMock.mockClear();
  acceptMock.mockClear();
});

describe('GET /legal/acceptance', () => {
  it('returns 200 with the legal status envelope', async () => {
    const res = await fetch(`${baseUrl}/legal/acceptance`);
    const body = (await res.json()) as {
      success: boolean;
      message: string;
      data: LegalStatus;
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(PENDING_STATUS);
    expect(getStatusMock).toHaveBeenCalledWith(AUTH_USER_ID);
  });
});

describe('POST /legal/acceptance', () => {
  it('returns 200 with the updated legal status envelope for a valid body', async () => {
    const res = await fetch(`${baseUrl}/legal/acceptance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: CURRENT_LEGAL_VERSION,
        platform: 'ios',
        appVersion: '1.2.0',
      }),
    });
    const body = (await res.json()) as {
      success: boolean;
      message: string;
      data: LegalStatus;
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(ACCEPTED_STATUS);
    expect(acceptMock).toHaveBeenCalledTimes(1);
    expect(acceptMock.mock.calls[0]?.[0]).toBe(AUTH_USER_ID);
    expect(acceptMock.mock.calls[0]?.[1]).toEqual({
      version: CURRENT_LEGAL_VERSION,
      platform: 'ios',
      appVersion: '1.2.0',
    });
  });

  it('returns 400 for an empty body without calling the service', async () => {
    const res = await fetch(`${baseUrl}/legal/acceptance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it('returns 409 with LEGAL_VERSION_MISMATCH when the service rejects a stale version', async () => {
    acceptMock.mockImplementationOnce(async () => {
      const { LegalVersionMismatchError } = await import(
        '../../../../../src/domains/legal/errors/legalErrors'
      );
      throw new LegalVersionMismatchError('2020-01-01', CURRENT_LEGAL_VERSION);
    });

    const res = await fetch(`${baseUrl}/legal/acceptance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: '2020-01-01' }),
    });
    const body = (await res.json()) as {
      success: boolean;
      error: {
        code: string;
        metadata: { reason: string; submitted: string; current: string };
      };
    };

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.metadata).toEqual({
      reason: 'LEGAL_VERSION_MISMATCH',
      submitted: '2020-01-01',
      current: CURRENT_LEGAL_VERSION,
    });
  });

  it('passes cf-connecting-ip header value as ctx.ip and user-agent as ctx.userAgent', async () => {
    const res = await fetch(`${baseUrl}/legal/acceptance`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.42',
        'user-agent': 'SteadilyNanny/2.0.0',
      },
      body: JSON.stringify({ version: CURRENT_LEGAL_VERSION }),
    });

    expect(res.status).toBe(200);
    expect(acceptMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      { version: CURRENT_LEGAL_VERSION },
      {
        ip: '203.0.113.42',
        userAgent: 'SteadilyNanny/2.0.0',
      }
    );
  });
});

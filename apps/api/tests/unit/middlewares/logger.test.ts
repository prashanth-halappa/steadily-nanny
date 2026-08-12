/**
 * F-B9-10: morgan access logs were burying payroll/business errors by all
 * logging at `info` — the same level as everything else. These tests pin two
 * behaviors: the winston level threshold comes from the validated
 * `env.LOG_LEVEL` (never raw `process.env`), and morgan access lines log at
 * `http`, not `info`.
 */

import { beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import type { Request } from 'express';
import { InviteNotFoundError } from '../../../src/domains/household/errors/householdErrors';
import { redactLoggedUrl } from '../../../src/utils/redactLoggedUrl';

type LoggerModule = typeof import('../../../src/middlewares/logger');

let mod: LoggerModule;

beforeAll(async () => {
  // The OLD code read `process.env.LOG_LEVEL` directly. Set it to a value the
  // mocked, validated `env` module disagrees with, so only the fixed code
  // (which must read `env.LOG_LEVEL`) can produce 'warn' below.
  process.env.LOG_LEVEL = 'error';
  mock.module('../../../src/config/env', () => ({
    env: { LOG_LEVEL: 'warn' },
    isTest: true,
  }));

  mod = await import('../../../src/middlewares/logger');
});

describe('logger level', () => {
  test('comes from validated env.LOG_LEVEL, not raw process.env', () => {
    expect(mod.logger.level).toBe('warn');
  });
});

describe('morgan access logging', () => {
  test('access lines log at http level, not info', () => {
    const httpSpy = spyOn(mod.logger, 'http').mockImplementation(
      () => mod.logger
    );
    const infoSpy = spyOn(mod.logger, 'info').mockImplementation(
      () => mod.logger
    );

    mod.logHttpAccess('GET /foo 200 - 3ms\n');

    expect(httpSpy).toHaveBeenCalledWith('GET /foo 200 - 3ms');
    expect(infoSpy).not.toHaveBeenCalled();

    httpSpy.mockRestore();
    infoSpy.mockRestore();
  });
});

describe('invite code URL redaction', () => {
  const SECRET_CODE = 'ABC-234';

  test('redactLoggedUrl masks public terms-preview paths', () => {
    expect(
      redactLoggedUrl(`/api/v1/household-invites/${SECRET_CODE}/terms-preview`)
    ).toBe('/api/v1/household-invites/:code/terms-preview');
    expect(
      redactLoggedUrl(
        `/api/v1/household-invites/${SECRET_CODE}/terms-preview?foo=bar`
      )
    ).toBe('/api/v1/household-invites/:code/terms-preview?foo=bar');
  });

  test('redactLoggedUrl masks public opened paths', () => {
    expect(
      redactLoggedUrl(`/api/v1/household-invites/${SECRET_CODE}/opened`)
    ).toBe('/api/v1/household-invites/:code/opened');
  });

  // Morgan logs 404s on the same prefix, so a bare probe with no route
  // segment after the code must redact too — the original regex required a
  // trailing slash and let this shape through (Phase 5 register walk).
  test('redactLoggedUrl masks a bare code with no trailing segment', () => {
    expect(redactLoggedUrl(`/api/v1/household-invites/${SECRET_CODE}`)).toBe(
      '/api/v1/household-invites/:code'
    );
  });

  test('redactLoggedUrl masks a bare code carrying a query string', () => {
    expect(
      redactLoggedUrl(`/api/v1/household-invites/${SECRET_CODE}?src=email`)
    ).toBe('/api/v1/household-invites/:code?src=email');
  });

  test('redactLoggedUrl leaves unrelated paths unchanged', () => {
    const path = '/api/v1/households/hh-1/invites';
    expect(redactLoggedUrl(path)).toBe(path);
  });

  test('morgan :url token redacts invite codes before access logging', () => {
    const req = {
      originalUrl: `/api/v1/household-invites/${SECRET_CODE}/terms-preview`,
      url: `/api/v1/household-invites/${SECRET_CODE}/terms-preview`,
    } as Request;

    const url = mod.redactedUrlToken(req);
    expect(url).not.toContain(SECRET_CODE);
    expect(url).toBe('/api/v1/household-invites/:code/terms-preview');
  });

  test('logError redacts invite code in path', () => {
    const warnSpy = spyOn(mod.logger, 'warn').mockImplementation(
      () => mod.logger
    );
    const req = {
      path: `/api/v1/household-invites/${SECRET_CODE}/terms-preview`,
      method: 'GET',
      id: 'req-1',
    } as Request;

    mod.logError(new InviteNotFoundError(SECRET_CODE), req);

    const logPayload = (
      warnSpy.mock.calls[0] as unknown as [string, { path: string }]
    )[1];
    expect(logPayload.path).not.toContain(SECRET_CODE);
    expect(logPayload.path).toBe(
      '/api/v1/household-invites/:code/terms-preview'
    );

    warnSpy.mockRestore();
  });
});

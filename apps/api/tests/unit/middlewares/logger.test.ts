/**
 * F-B9-10: morgan access logs were burying payroll/business errors by all
 * logging at `info` — the same level as everything else. These tests pin two
 * behaviors: the winston level threshold comes from the validated
 * `env.LOG_LEVEL` (never raw `process.env`), and morgan access lines log at
 * `http`, not `info`.
 */
import { beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';

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

/**
 * The generic 500 branch must never echo `details`/`stack` unless NODE_ENV is
 * EXPLICITLY development or test. On Workers, wrangler inlines
 * `process.env.NODE_ENV` at build time from the deploying shell (bunx loads
 * apps/api/.env → "development"), so the deployed Worker leaked stacks despite
 * the `NODE_ENV=production` var. Unset must fail closed too.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import type { Request, Response } from 'express';
import { errorHandler } from '../../../src/middlewares/errorHandler';

const originalNodeEnv = process.env.NODE_ENV;
afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

function run500(nodeEnv: string | undefined) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;

  let status = 0;
  let body: { error: Record<string, unknown> } | undefined;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: { error: Record<string, unknown> }) {
      body = payload;
      return this;
    },
  } as unknown as Response;
  const req = {
    path: '/api/v1/boom',
    url: '/api/v1/boom',
    method: 'GET',
    headers: {},
    query: {},
    id: 'req-1',
  } as unknown as Request;

  errorHandler(new Error('secret internal detail'), req, res, () => {});
  process.env.NODE_ENV = originalNodeEnv;
  if (!body) throw new Error('errorHandler did not respond');
  return { status, error: body.error };
}

describe('errorHandler 500 body', () => {
  for (const nodeEnv of ['production', undefined, 'staging']) {
    test(`NODE_ENV=${nodeEnv ?? '(unset)'} omits stack and details`, () => {
      const { status, error } = run500(nodeEnv);
      expect(status).toBe(500);
      expect(error.stack).toBeUndefined();
      expect(error.details).toBeUndefined();
      // Shape the mobile client relies on stays intact.
      expect(error.message).toBe('An unexpected error occurred');
      expect(error.code).toBeDefined();
      expect(error.name).toBe('InternalServerError');
    });
  }

  for (const nodeEnv of ['development', 'test']) {
    test(`NODE_ENV=${nodeEnv} includes stack and details`, () => {
      const { error } = run500(nodeEnv);
      expect(error.details).toBe('secret internal detail');
      expect(typeof error.stack).toBe('string');
    });
  }
});

test('never reads the build-time-inlined `process.env.NODE_ENV` expression', async () => {
  // wrangler's esbuild `define` rewrites that exact member expression to a
  // string literal at bundle time, so a runtime var can't override it.
  const src = await Bun.file(
    new URL('../../../src/middlewares/errorHandler.ts', import.meta.url)
  ).text();
  expect(src).not.toMatch(/process\.env\.NODE_ENV/);
});

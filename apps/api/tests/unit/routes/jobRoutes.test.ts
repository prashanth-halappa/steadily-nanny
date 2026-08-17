/**
 * @module tests/unit/routes/jobRoutes.test
 * S15 — every route in `jobRoutes.ts` sits before the Supabase auth layer,
 * guarded only by `validateJobApiKey`. This iterates the router's own
 * `router.stack` so a route added later without the guard fails this test
 * automatically, rather than relying on a hand-maintained list of paths.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import type { NextFunction, Request, Response, Router } from 'express';

let jobRoutes: Router;

beforeAll(async () => {
  process.env.JOB_API_KEY = 'the-real-key';
  jobRoutes = (await import('../../../src/routes/jobRoutes')).default;
});

interface RouteEntry {
  path: string;
  method: string;
}

/** Pull every {method, path} pair Express actually registered on the router. */
function listRoutes(router: Router): RouteEntry[] {
  const entries: RouteEntry[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: Express's Layer type isn't exported
  for (const layer of (router as any).stack as any[]) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods).filter(
      m => layer.route.methods[m]
    );
    for (const method of methods) {
      entries.push({ path: layer.route.path, method: method.toUpperCase() });
    }
  }
  return entries;
}

function fakeRes(): Response & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {
    locals: {},
  };
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response['status'];
  res.json = ((body: unknown) => {
    res.body = body;
    return res;
  }) as Response['json'];
  return res as Response & { statusCode?: number; body?: unknown };
}

describe('jobRoutes — S15: every route requires X-Job-Api-Key', () => {
  it('registers at least the ten known job endpoints', () => {
    const routes = listRoutes(jobRoutes);
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  it('401s every registered route when the header is missing', async () => {
    const routes = listRoutes(jobRoutes);
    expect(routes.length).toBeGreaterThan(0);

    for (const { path, method } of routes) {
      const req = {
        method,
        url: path,
        headers: {},
        ip: '198.51.100.1',
      } as unknown as Request;
      const res = fakeRes();
      let nextCalledWith: unknown = 'not-called';
      const next = ((err?: unknown) => {
        nextCalledWith = err;
      }) as NextFunction;

      // biome-ignore lint/suspicious/noExplicitAny: Router is callable middleware
      await (jobRoutes as any)(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(nextCalledWith).toBe('not-called');
    }
  });

  it('calls through when the correct header is present', async () => {
    const routes = listRoutes(jobRoutes);
    const [first] = routes;
    expect(first).toBeDefined();
    if (!first) return;

    const req = {
      method: first.method,
      url: first.path,
      headers: { 'x-job-api-key': 'the-real-key' },
      ip: '198.51.100.1',
    } as unknown as Request;
    const res = fakeRes();
    const next = (() => undefined) as NextFunction;

    // biome-ignore lint/suspicious/noExplicitAny: Router is callable middleware
    await (jobRoutes as any)(req, res, next);

    // The route handler fire-and-forgets async work against a real Supabase
    // client in this environment, so a 401 is the only thing this test can
    // assert about failure — success here is simply "not 401".
    expect(res.statusCode).not.toBe(401);
  });
});

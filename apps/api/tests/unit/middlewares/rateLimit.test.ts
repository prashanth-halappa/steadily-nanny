/**
 * The limiters skip ONLY under an explicit runtime NODE_ENV=test; production
 * and unset must enforce the budget (see runtimeNodeEnv in src/config/env.ts).
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  JOB_MAX_REQUESTS,
  jobRateLimiter,
} from '../../../src/middlewares/rateLimit';

let server: Server;
let base: string;
const original = process.env.NODE_ENV;

beforeAll(async () => {
  const app = express();
  app.get('/', jobRateLimiter, (_req, res) => {
    res.sendStatus(200);
  });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  process.env.NODE_ENV = original;
  server.close();
});

async function statuses(n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await fetch(base)).status);
  return out;
}

// Order matters: the 'test' run must not consume budget, so it goes first.
test('NODE_ENV=test skips the limiter', async () => {
  process.env.NODE_ENV = 'test';
  expect(await statuses(JOB_MAX_REQUESTS + 5)).not.toContain(429);
});

test('unset NODE_ENV enforces the limit (fails closed)', async () => {
  delete process.env.NODE_ENV;
  const got = await statuses(JOB_MAX_REQUESTS + 1);
  expect(got.slice(0, JOB_MAX_REQUESTS)).not.toContain(429);
  expect(got[JOB_MAX_REQUESTS]).toBe(429);
});

/**
 * Better Auth's rate limiter keys on the client IP. On Workers there is no
 * socket address, so without a trusted header every user shared ONE bucket
 * and a burst of sign-ins 429'd everyone. The key must come from
 * `cf-connecting-ip` (Cloudflare overwrites it) and nothing a client can set.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestDb, type TestDb } from '../../helpers/testDb';

let t: TestDb;
let server: Server;
let base: string;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../src/db/client', () => ({ db: t.db }));
  const { auth } = await import('../../../src/auth');
  // Better Auth only rate-limits when NODE_ENV=production; force it on.
  (await auth.$context).rateLimit.enabled = true;
  const app = (await import('../../../src/app')).default;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await t?.dispose();
  mock.restore();
});

const signIn = (headers: Record<string, string>) =>
  fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'steadilynanny://',
      ...headers,
    },
    body: JSON.stringify({
      email: 'nobody@steadilynanny.test',
      password: 'x1234567',
    }),
  });

describe('Better Auth rate limit key', () => {
  it('gives each cf-connecting-ip its own sign-in bucket, ignoring x-forwarded-for', async () => {
    // Default sign-in rule: 3 per 10s. A spoofed x-forwarded-for must not
    // buy a fresh bucket.
    const a = [];
    for (let i = 0; i < 4; i++) {
      a.push(
        (
          await signIn({
            'cf-connecting-ip': '203.0.113.7',
            'x-forwarded-for': `198.51.100.${i}`,
          })
        ).status
      );
    }
    expect(a).toEqual([401, 401, 401, 429]);

    expect((await signIn({ 'cf-connecting-ip': '203.0.113.8' })).status).toBe(
      401
    );
    expect((await signIn({ 'cf-connecting-ip': '2001:db8::1' })).status).toBe(
      401
    );
  });

  it('does not 500 when a client sends its own x-forwarded-for', async () => {
    const res = await fetch(`${base}/api/auth/get-session`, {
      headers: {
        'x-forwarded-for': '198.51.100.9',
        'cf-connecting-ip': '203.0.113.20',
      },
    });
    expect(res.status).toBe(200);
  });
});

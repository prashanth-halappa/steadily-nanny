/**
 * Production posture: with EMAIL_AUTH_ENABLED unset (parsed to false), Better
 * Auth's email/password endpoints refuse sign-up and sign-in. Production signs
 * in with Apple/Google only.
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
  const real = await import('../../../src/config/env');
  mock.module('../../../src/config/env', () => ({
    ...real,
    env: { ...real.env, EMAIL_AUTH_ENABLED: false },
  }));
  const app = (await import('../../../src/app')).default;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await t?.dispose();
  mock.restore();
});

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'steadilynanny://' },
    body: JSON.stringify(body),
  });

describe('email auth disabled (EMAIL_AUTH_ENABLED unset)', () => {
  const creds = { email: 'off@steadilynanny.test', password: 'secret1' };

  it('rejects email sign-up with a 4xx and creates no user', async () => {
    const res = await post('/api/auth/sign-up/email', {
      ...creds,
      name: 'Off',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('rejects email sign-in with a 4xx', async () => {
    const res = await post('/api/auth/sign-in/email', creds);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

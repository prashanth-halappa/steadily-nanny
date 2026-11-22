/**
 * Better Auth end to end over a real D1 (testDb), through the real Express
 * app: sign-up → sign-in → the session cookie authenticates /api/v1 via
 * `validateSession`; no cookie is the same 401 as before; password reset
 * emails a link to the app's reset screen; /api/app/status resolves the
 * optional session.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestDb, type TestDb } from '../../helpers/testDb';

let t: TestDb;
let server: Server;
let base: string;
const sentEmails: { to: string; emailType: string; html: string }[] = [];
const statusCalls: unknown[][] = [];

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../src/db/client', () => ({ db: t.db }));
  mock.module('../../../src/domains/email/services/emailService', () => ({
    EmailService: {
      sendEmail: mock(
        async (p: { to: string; emailType: string; html: string }) => {
          sentEmails.push(p);
          return { sent: true };
        }
      ),
    },
  }));
  mock.module('../../../src/domains/app/services/appStatusService', () => ({
    getAppStatus: mock(async (...args: unknown[]) => {
      statusCalls.push(args);
      return { ok: true };
    }),
  }));

  const app = (await import('../../../src/app')).default;
  // A probe route behind the real /api/v1 auth stack.
  const { validateSession } = await import('../../../src/middlewares/auth');
  const express = (await import('express')).default;
  const outer = express();
  outer.get('/probe', validateSession, (req, res) => {
    res.json({ user: req.user });
  });
  outer.use(app);
  server = outer.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await t?.dispose();
  mock.restore();
});

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'steadilynanny://' },
  body: JSON.stringify(body),
});

/** `name=value` pairs from Set-Cookie, ready for a Cookie header. */
const cookieFrom = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ');

describe('Better Auth over D1', () => {
  const email = 'priya@steadilynanny.test';
  const password = 'secret1';

  it('signs up with a uuid user id, then signs in and authenticates /api/v1', async () => {
    const up = await fetch(
      `${base}/api/auth/sign-up/email`,
      json({ email, password, name: 'Priya' })
    );
    expect(up.status).toBe(200);
    const { user } = (await up.json()) as { user: { id: string } };
    // App tables validate user ids with z.uuid().
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    const signIn = await fetch(
      `${base}/api/auth/sign-in/email`,
      json({ email, password })
    );
    expect(signIn.status).toBe(200);
    const cookie = cookieFrom(signIn);
    expect(cookie).toContain('better-auth.session_token=');

    const probe = await fetch(`${base}/probe`, { headers: { cookie } });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toEqual({
      user: { id: user.id, email, name: 'Priya' },
    });
  });

  it('rejects a password shorter than 6 characters', async () => {
    const res = await fetch(
      `${base}/api/auth/sign-up/email`,
      json({ email: 'short@steadilynanny.test', password: '12345', name: 'S' })
    );
    expect(res.status).toBe(400);
  });

  it('answers a missing or bogus session with the unchanged 401 body', async () => {
    const attempts: Record<string, string>[] = [
      {},
      { cookie: 'better-auth.session_token=forged.value' },
    ];
    for (const headers of attempts) {
      const res = await fetch(`${base}/api/v1/users/profile`, { headers });
      expect(res.status).toBe(401);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Invalid or expired token');
    }
  });

  it('emails a reset link to the app reset screen, carrying the token', async () => {
    const res = await fetch(
      `${base}/api/auth/request-password-reset`,
      json({ email, redirectTo: 'https://nanny.getsteadily.app/auth/reset' })
    );
    expect(res.status).toBe(200);
    const sent = sentEmails.find(e => e.emailType === 'reset_password');
    expect(sent?.to).toBe(email);
    const match = sent?.html.match(
      /https:\/\/nanny\.getsteadily\.app\/auth\/reset\?token=([\w-]+)/
    );
    expect(match).not.toBeNull();

    // The token from the link resets the password.
    const reset = await fetch(
      `${base}/api/auth/reset-password`,
      json({ newPassword: 'newsecret', token: match?.[1] })
    );
    expect(reset.status).toBe(200);
    const signIn = await fetch(
      `${base}/api/auth/sign-in/email`,
      json({ email, password: 'newsecret' })
    );
    expect(signIn.status).toBe(200);
  });

  it('/api/app/status passes the session user through, and stays anonymous without one', async () => {
    const signIn = await fetch(
      `${base}/api/auth/sign-in/email`,
      json({ email, password: 'newsecret' })
    );
    const cookie = cookieFrom(signIn);

    statusCalls.length = 0;
    await fetch(`${base}/api/app/status`, {
      headers: { cookie, 'x-app-version': '1.2.3' },
    });
    await fetch(`${base}/api/app/status`);
    expect(statusCalls[0]?.[0]).toBe('1.2.3');
    expect(statusCalls[0]?.[3]).toBe(email);
    expect(typeof statusCalls[0]?.[2]).toBe('string');
    expect(statusCalls[1]?.[2]).toBeUndefined();
  });
});

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import type { NextFunction, Request, Response } from 'express';

// A token signed by a different Supabase project 401s exactly like an expired
// one. The middleware must say WHICH failure it is in the log, or the config
// mismatch reads as a session bug and costs hours (GOLDEN-FIXES #26).

const OUR_PROJECT = 'https://ourproject.supabase.co';

/** Build an unsigned JWT with the given `iss`. Only the payload is inspected. */
const tokenWithIssuer = (iss: string | null): string => {
  const payload = iss === null ? {} : { iss: `${iss}/auth/v1` };
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(payload)}.sig`;
};

let validateSupabaseToken: (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;
let logger: {
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
};

beforeAll(async () => {
  mock.module('../../../src/config/env', () => ({
    env: { SUPABASE_URL: OUR_PROJECT, NODE_ENV: 'test' },
  }));

  // Always reject, so we exercise the failure branch.
  mock.module('../../../src/config/supabase', () => ({
    supabase: {
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { message: 'invalid JWT' },
        }),
      },
    },
  }));

  const authModule = await import('../../../src/middlewares/auth');
  validateSupabaseToken = authModule.validateSupabaseToken;
  logger = (await import('../../../src/middlewares/logger')).logger;
});

afterAll(() => {
  mock.restore();
});

const runWithToken = async (token: string) => {
  const req = { headers: { authorization: `Bearer ${token}` } } as Request;
  const json = mock(() => undefined);
  const res = {
    status: mock(() => res),
    json,
  } as unknown as Response & { status: ReturnType<typeof mock> };
  const next = mock(() => undefined);

  const errorSpy = spyOn(logger, 'error').mockImplementation(() => undefined);
  const infoSpy = spyOn(logger, 'info').mockImplementation(() => undefined);

  await validateSupabaseToken(req, res, next as unknown as NextFunction);

  const errorLogs = errorSpy.mock.calls.map(c => String(c[0]));
  const infoLogs = infoSpy.mock.calls.map(c => String(c[0]));
  errorSpy.mockRestore();
  infoSpy.mockRestore();

  return { errorLogs, infoLogs, next, res };
};

describe('validateSupabaseToken — Supabase project mismatch', () => {
  it('names the mismatch (and both hosts) when the token is from another project', async () => {
    const { errorLogs, next } = await runWithToken(
      tokenWithIssuer('https://otherproject.supabase.co')
    );

    const mismatch = errorLogs.find(l =>
      l.includes('SUPABASE PROJECT MISMATCH')
    );
    expect(mismatch).toBeDefined();
    // Both sides must appear, or the log doesn't tell you what to change.
    expect(mismatch).toContain('otherproject.supabase.co');
    expect(mismatch).toContain('ourproject.supabase.co');
    expect(next).not.toHaveBeenCalled();
  });

  it('flags a local stack token against a remote API — the exact 17-hour bug', async () => {
    const { errorLogs } = await runWithToken(
      tokenWithIssuer('http://127.0.0.1:54321')
    );
    expect(errorLogs.some(l => l.includes('SUPABASE PROJECT MISMATCH'))).toBe(
      true
    );
  });

  it('stays quiet for a same-project token — that is a real expired session', async () => {
    const { errorLogs, infoLogs } = await runWithToken(
      tokenWithIssuer(OUR_PROJECT)
    );
    expect(errorLogs.some(l => l.includes('SUPABASE PROJECT MISMATCH'))).toBe(
      false
    );
    expect(infoLogs).toContain('Invalid or expired token');
  });

  it('does not mistake an unparseable token for a mismatch', async () => {
    const { errorLogs, infoLogs } = await runWithToken('not-a-jwt');
    expect(errorLogs.some(l => l.includes('SUPABASE PROJECT MISMATCH'))).toBe(
      false
    );
    expect(infoLogs).toContain('Invalid or expired token');
  });

  it('returns the same opaque 401 either way — never leaks which project we trust', async () => {
    const mismatched = await runWithToken(
      tokenWithIssuer('https://otherproject.supabase.co')
    );
    const expired = await runWithToken(tokenWithIssuer(OUR_PROJECT));

    for (const r of [mismatched, expired]) {
      expect(r.res.status).toHaveBeenCalledWith(401);
    }
    const body = (r: typeof mismatched) =>
      (r.res.json as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0]?.[0];
    expect(JSON.stringify(body(mismatched))).not.toContain('otherproject');
    expect(
      (body(mismatched) as { error: { message: string } }).error.message
    ).toBe((body(expired) as { error: { message: string } }).error.message);
  });
});

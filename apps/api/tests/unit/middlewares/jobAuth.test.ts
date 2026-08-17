/**
 * @module tests/unit/middlewares/jobAuth.test
 * S15 (WP-J1/J2) — `jobAuth.ts` had NO test. All five mutating job endpoints
 * sit before the Supabase auth layer, guarded only by this shared static key.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextFunction, Request, Response } from 'express';
import { validateJobApiKey } from '../../../src/middlewares/jobAuth';

const ORIGINAL_KEY = process.env.JOB_API_KEY;

function buildRes(): Response & {
  status: ReturnType<typeof mock>;
  json: ReturnType<typeof mock>;
} {
  const json = mock(() => undefined);
  const res = {
    status: mock(() => res),
    json,
  };
  return res as unknown as Response & {
    status: ReturnType<typeof mock>;
    json: ReturnType<typeof mock>;
  };
}

function buildReq(headers: Record<string, unknown> = {}): Request {
  return { headers, path: '/api/jobs/example', ip: '127.0.0.1' } as Request;
}

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    process.env.JOB_API_KEY = undefined;
  } else {
    process.env.JOB_API_KEY = ORIGINAL_KEY;
  }
});

describe('validateJobApiKey', () => {
  beforeEach(() => {
    process.env.JOB_API_KEY = 'the-real-key';
  });

  it('401s when the header is missing', () => {
    const req = buildReq();
    const res = buildRes();
    const next = mock(() => undefined) as unknown as NextFunction;

    validateJobApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s when the header holds the wrong key', () => {
    const req = buildReq({ 'x-job-api-key': 'wrong-key' });
    const res = buildRes();
    const next = mock(() => undefined) as unknown as NextFunction;

    validateJobApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the header holds the correct key', () => {
    const req = buildReq({ 'x-job-api-key': 'the-real-key' });
    const res = buildRes();
    const next = mock(() => undefined) as unknown as NextFunction;

    validateJobApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('500s when JOB_API_KEY is not configured server-side, even with a header present', () => {
    process.env.JOB_API_KEY = undefined;
    const req = buildReq({ 'x-job-api-key': 'anything' });
    const res = buildRes();
    const next = mock(() => undefined) as unknown as NextFunction;

    validateJobApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s when the header is present but not a string (e.g. repeated header → array)', () => {
    const req = buildReq({ 'x-job-api-key': ['the-real-key', 'the-real-key'] });
    const res = buildRes();
    const next = mock(() => undefined) as unknown as NextFunction;

    validateJobApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

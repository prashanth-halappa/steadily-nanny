import { afterEach, describe, expect, test } from 'bun:test';
import type { NextFunction, Request, Response } from 'express';
import {
  CACHEABLE_ROUTES,
  cacheControl,
  STATIC_ROUTES,
} from '../../../src/middlewares/cacheControl';

type HeaderBag = Record<string, string>;

function fakeReq(path: string): Request {
  return { path } as unknown as Request;
}

function fakeRes(): { res: Response; headers: HeaderBag } {
  const headers: HeaderBag = {};
  const res = {
    set(name: string, value: string) {
      headers[name] = value;
      return res;
    },
  } as unknown as Response;
  return { res, headers };
}

function run(path: string): HeaderBag {
  const { res, headers } = fakeRes();
  let nextCalled = false;
  cacheControl(fakeReq(path), res, (() => {
    nextCalled = true;
  }) as NextFunction);
  expect(nextCalled).toBe(true);
  return headers;
}

describe('cacheControl', () => {
  afterEach(() => {
    CACHEABLE_ROUTES.length = 0;
    STATIC_ROUTES.length = 0;
  });

  test('default /api/v1 path is no-store (deny by default)', () => {
    const headers = run('/api/v1/expenses');

    expect(headers['Cache-Control']).toBe(
      'no-cache, no-store, must-revalidate'
    );
    expect(headers.Pragma).toBe('no-cache');
    expect(headers.Expires).toBe('0');
    // Vary: Authorization is meaningless on uncached responses — must not appear.
    expect(headers.Vary).toBeUndefined();
  });

  test('whitelisted CACHEABLE_ROUTES path gets a short private cache', () => {
    CACHEABLE_ROUTES.push('/api/v1/catalog');

    const headers = run('/api/v1/catalog/items');

    expect(headers['Cache-Control']).toBe('private, max-age=300');
    expect(headers.Vary).toBe('Accept-Encoding, Authorization');
  });

  test('STATIC_ROUTES path is unchanged (public 24h)', () => {
    STATIC_ROUTES.push('/api/v1/config');

    const headers = run('/api/v1/config');

    expect(headers['Cache-Control']).toBe('public, max-age=86400');
    expect(headers.Vary).toBe('Accept-Encoding');
  });
});

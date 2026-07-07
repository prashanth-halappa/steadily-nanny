import { describe, expect, test } from 'bun:test';
import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../../../src/errors';
import { makeOwnershipValidator } from '../../../src/middlewares/validateResourceOwnership';

// Minimal Request/Response doubles — the validator only reads user/params and
// attaches the looked-up resource, so a partial shape is enough.
function fakeReq(userId: string, id: string): Request {
  return {
    user: { id: userId },
    params: { id },
    query: {},
    body: {},
  } as unknown as Request;
}

describe('makeOwnershipValidator', () => {
  test('attaches the resource and calls next() on a successful lookup', async () => {
    const validator = makeOwnershipValidator({
      param: 'id',
      lookup: async () => ({ id: 'r-success', owner: 'u1' }),
    });
    const req = fakeReq('u1', 'r-success');
    let error: unknown;
    await (validator(
      req,
      {} as Response,
      ((e?: unknown) => {
        error = e;
      }) as NextFunction
    ) as unknown as Promise<void>);

    expect(error).toBeUndefined();
    expect(
      (req as unknown as { ownedResource: unknown }).ownedResource
    ).toEqual({
      id: 'r-success',
      owner: 'u1',
    });
  });

  test('forwards a NotFoundError when the lookup rejects (not owned)', async () => {
    const validator = makeOwnershipValidator({
      param: 'id',
      lookup: async () => {
        throw new NotFoundError('nope');
      },
    });
    const req = fakeReq('u2', 'r-missing');
    let error: unknown;
    await (validator(
      req,
      {} as Response,
      ((e?: unknown) => {
        error = e;
      }) as NextFunction
    ) as unknown as Promise<void>);

    expect(error).toBeInstanceOf(NotFoundError);
  });
});

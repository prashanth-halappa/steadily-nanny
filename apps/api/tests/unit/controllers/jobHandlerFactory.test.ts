import { describe, expect, test } from 'bun:test';
import type { NextFunction, Request, Response } from 'express';
import { createSimpleJobHandler } from '../../../src/controllers/jobHandlerFactory';

function fakeRes(): Response & { statusCode?: number; body?: any } {
  const res: any = { locals: { requestId: 'req-1' } };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('createSimpleJobHandler', () => {
  test('runs the job and responds with a success envelope', async () => {
    const handler = createSimpleJobHandler(
      'example',
      async () => ({ successCount: 1 }),
      'done'
    );
    const res = fakeRes();
    let error: unknown;
    await handler({} as Request, res, ((e?: unknown) => {
      error = e;
    }) as NextFunction);

    expect(error).toBeUndefined();
    expect(res.body.success).toBe(true);
    expect(res.body.data.job).toBe('example');
    expect(res.body.data.successCount).toBe(1);
  });

  test('forwards a thrown job error to next()', async () => {
    const handler = createSimpleJobHandler(
      'example',
      async () => {
        throw new Error('boom');
      },
      'done'
    );
    const res = fakeRes();
    let error: unknown;
    await handler({} as Request, res, ((e?: unknown) => {
      error = e;
    }) as NextFunction);

    expect(error).toBeInstanceOf(Error);
  });
});

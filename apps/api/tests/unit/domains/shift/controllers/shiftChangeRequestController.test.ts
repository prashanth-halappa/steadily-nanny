/**
 * ShiftChangeRequestController — HTTP shape of the extra-shift response.
 *
 * The created arm is the only one with a real shape decision in it: the same
 * `{ shift, warnings }` envelope is returned whether the service wrote the
 * shift or adopted one that was already there, so `adopted` is the only thing
 * on the wire that tells the two apart (D4 / the C4-C5 double-push residual).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ShiftChangeRequestController: any;
let createExtraShift: any;
let collectClashWarningsForCarer: any;

const createdShift = {
  id: 's-extra',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-05T09:00:00.000Z',
  ends_at: '2026-08-05T17:00:00.000Z',
  timezone: 'Europe/London',
  kind: 'extra',
  status: 'pending',
  shift_children: [],
};

beforeAll(async () => {
  createExtraShift = mock(async () => ({
    status: 'created',
    shift: createdShift,
    adopted: false,
  }));
  collectClashWarningsForCarer = mock(async () => []);

  mock.module(
    '../../../../../src/domains/shift/services/shiftChangeRequestCommandService',
    () => ({
      shiftChangeRequestCommandService: { createExtraShift },
    })
  );
  mock.module(
    '../../../../../src/domains/shift/services/shiftChangeRequestQueryService',
    () => ({ shiftChangeRequestQueryService: {} })
  );
  mock.module('../../../../../src/domains/me/services/clashWarning', () => ({
    collectClashWarningsForCarer,
  }));

  ShiftChangeRequestController = (
    await import(
      '../../../../../src/domains/shift/controllers/shiftChangeRequestController'
    )
  ).ShiftChangeRequestController;
});

function mockRes(): any {
  const res: any = { locals: { requestId: 'req-1' }, req: { path: '/x' } };
  res.status = mock((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = mock((body: any) => {
    res.body = body;
    return res;
  });
  return res;
}

function req(): any {
  return {
    user: { id: 'parent-1' },
    params: { householdId: 'h1' },
    body: {
      starts_at: createdShift.starts_at,
      ends_at: createdShift.ends_at,
      timezone: createdShift.timezone,
    },
  };
}

beforeEach(() => {
  createExtraShift.mockClear();
  collectClashWarningsForCarer.mockClear();
});

describe('ShiftChangeRequestController.createExtraShift', () => {
  it('carries adopted: false on a genuine create', async () => {
    const res = mockRes();
    await ShiftChangeRequestController.createExtraShift(req(), res, mock());

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      status: 'created',
      shift: createdShift,
      warnings: [],
      adopted: false,
    });
  });

  it('carries adopted: true when the service adopted an existing shift', async () => {
    createExtraShift.mockImplementationOnce(async () => ({
      status: 'created',
      shift: createdShift,
      adopted: true,
    }));
    const res = mockRes();
    await ShiftChangeRequestController.createExtraShift(req(), res, mock());

    expect(res.body.data.adopted).toBe(true);
  });

  it('leaves the pending_approval arm alone — nothing was created to adopt', async () => {
    createExtraShift.mockImplementationOnce(async () => ({
      status: 'pending_approval',
      approval: { id: 'ap-1' },
    }));
    const res = mockRes();
    await ShiftChangeRequestController.createExtraShift(req(), res, mock());

    expect(res.body.data).toEqual({
      status: 'pending_approval',
      approval: { id: 'ap-1' },
    });
    expect(collectClashWarningsForCarer).not.toHaveBeenCalled();
  });
});

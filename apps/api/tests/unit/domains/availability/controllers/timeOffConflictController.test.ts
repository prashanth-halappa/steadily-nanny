/**
 * Controller must surface affected_shift_count and still return 201 when
 * the service completes (push failures are swallowed in the service).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimeOffController: typeof import('../../../../../src/domains/availability/controllers/timeOffController').TimeOffController;
let create: ReturnType<typeof mock>;
let update: ReturnType<typeof mock>;

beforeAll(async () => {
  create = mock(async () => ({
    carer_time_off: { id: 't-new', status: 'confirmed' },
    affected_shift_count: 3,
  }));
  update = mock(async () => ({
    carer_time_off: { id: 't1', status: 'confirmed' },
    affected_shift_count: 1,
  }));

  mock.module(
    '../../../../../src/domains/availability/services/timeOffQueryService',
    () => ({
      timeOffQueryService: { listOwn: mock(async () => []) },
    })
  );
  mock.module(
    '../../../../../src/domains/availability/services/timeOffCommandService',
    () => ({
      timeOffCommandService: {
        create,
        update,
        cancel: mock(async () => ({ id: 't1', status: 'cancelled' })),
      },
    })
  );

  ({ TimeOffController } = await import(
    '../../../../../src/domains/availability/controllers/timeOffController'
  ));
});

function mockRes(): {
  locals: { requestId: string };
  req: { path: string };
  statusCode?: number;
  body?: unknown;
  status: ReturnType<typeof mock>;
  json: ReturnType<typeof mock>;
} {
  const res: {
    locals: { requestId: string };
    req: { path: string };
    statusCode?: number;
    body?: unknown;
    status: ReturnType<typeof mock>;
    json: ReturnType<typeof mock>;
  } = {
    locals: { requestId: 'req-1' },
    req: { path: '/x' },
    status: mock((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: mock((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

beforeEach(() => {
  create.mockClear();
  update.mockClear();
});

describe('TimeOffController create/update — affected_shift_count', () => {
  it('create responds 201 with carer_time_off and affected_shift_count', async () => {
    const res = mockRes();
    await TimeOffController.create(
      {
        user: { id: 'u1' },
        body: { starts_at: 's', ends_at: 'e' },
      } as never,
      res as never,
      mock()
    );
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        data: {
          carer_time_off: { id: 't-new', status: 'confirmed' },
          affected_shift_count: 3,
        },
      })
    );
  });

  it('update responds 200 with affected_shift_count', async () => {
    const res = mockRes();
    await TimeOffController.update(
      {
        user: { id: 'u1' },
        params: { id: 't1' },
        body: { message: 'note' },
      } as never,
      res as never,
      mock()
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        data: {
          carer_time_off: { id: 't1', status: 'confirmed' },
          affected_shift_count: 1,
        },
      })
    );
  });
});

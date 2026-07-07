import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// The controller delegates to the two service singletons; mock them and assert
// the HTTP shaping (status code + envelope payload) and error forwarding.
let WidgetController: any;
let listForOwner: any;
let getOwned: any;
let create: any;
let update: any;
let del: any;
let generateDescription: any;
let notify: any;

beforeAll(async () => {
  listForOwner = mock(async () => [{ id: 'w1' }]);
  getOwned = mock(async () => ({ id: 'w1', name: 'W' }));
  create = mock(async () => ({ id: 'w-new', name: 'New' }));
  update = mock(async () => ({ id: 'w1', name: 'Updated' }));
  del = mock(async () => {});
  generateDescription = mock(async () => ({ id: 'w1', description: 'd' }));
  notify = mock(async () => ({ sent: 1, invalidTokens: [] }));

  mock.module(
    '../../../../../src/domains/widget/services/widgetQueryService',
    () => ({ widgetQueryService: { listForOwner, getOwned } })
  );
  mock.module(
    '../../../../../src/domains/widget/services/widgetCommandService',
    () => ({
      widgetCommandService: {
        create,
        update,
        delete: del,
        generateDescription,
        notify,
      },
    })
  );

  WidgetController = (
    await import(
      '../../../../../src/domains/widget/controllers/widgetController'
    )
  ).WidgetController;
});

function mockRes() {
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

beforeEach(() => {
  for (const m of [
    listForOwner,
    getOwned,
    create,
    update,
    del,
    generateDescription,
    notify,
  ]) {
    m.mockClear?.();
  }
});

describe('WidgetController', () => {
  it('list responds 200 with the widgets payload', async () => {
    const res = mockRes();
    const next = mock();
    await WidgetController.list({ user: { id: 'u1' } } as any, res, next);

    expect(listForOwner).toHaveBeenCalledWith('u1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ widgets: [{ id: 'w1' }] });
    expect(next).not.toHaveBeenCalled();
  });

  it('getById reads the widget id param and enforces ownership', async () => {
    const res = mockRes();
    await WidgetController.getById(
      { user: { id: 'u1' }, params: { widgetId: 'w1' } } as any,
      res,
      mock()
    );
    expect(getOwned).toHaveBeenCalledWith('u1', 'w1');
    expect(res.body.data).toEqual({ widget: { id: 'w1', name: 'W' } });
  });

  it('create responds 201', async () => {
    const res = mockRes();
    await WidgetController.create(
      { user: { id: 'u1' }, body: { name: 'New' } } as any,
      res,
      mock()
    );
    expect(create).toHaveBeenCalledWith('u1', { name: 'New' });
    expect(res.statusCode).toBe(201);
  });

  it('remove responds 200 with success', async () => {
    const res = mockRes();
    await WidgetController.remove(
      { user: { id: 'u1' }, params: { widgetId: 'w1' } } as any,
      res,
      mock()
    );
    expect(del).toHaveBeenCalledWith('u1', 'w1');
    expect(res.body.data).toEqual({ success: true });
  });

  it('generateDescription passes a display name derived from the email (PII demo)', async () => {
    const res = mockRes();
    await WidgetController.generateDescription(
      {
        user: { id: 'u1', email: 'alex@example.com' },
        params: { widgetId: 'w1' },
      } as any,
      res,
      mock()
    );
    expect(generateDescription).toHaveBeenCalledWith('u1', 'w1', 'alex');
  });

  it('notify responds with the send result', async () => {
    const res = mockRes();
    await WidgetController.notify(
      { user: { id: 'u1' }, params: { widgetId: 'w1' } } as any,
      res,
      mock()
    );
    expect(notify).toHaveBeenCalledWith('u1', 'w1');
    expect(res.body.data).toEqual({ sent: 1, invalidTokens: [] });
  });

  it('forwards service errors to next()', async () => {
    getOwned.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await WidgetController.getById(
      { user: { id: 'u1' }, params: { widgetId: 'w1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

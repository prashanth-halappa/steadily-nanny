import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let widgetApi: any;
let apiClient: any;

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
      post: mock(() => Promise.resolve({})),
      put: mock(() => Promise.resolve({})),
      patch: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
  }));

  widgetApi = (await import('../widgets')).widgetApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

// Valid UUIDs — the shared WidgetSchema enforces z.uuid() on id/owner_id.
const WIDGET_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const widget = {
  id: WIDGET_ID,
  owner_id: OWNER_ID,
  name: 'My Widget',
  description: null,
  tags: [],
  created_at: 't',
  updated_at: 't',
};

beforeEach(() => {
  for (const method of ['get', 'post', 'delete']) {
    apiClient[method].mockReset?.();
  }
});

describe('widgetApi.list', () => {
  it('GETs /v1/widgets and returns the validated widgets array', async () => {
    apiClient.get.mockResolvedValue({ data: { data: { widgets: [widget] } } });
    const result = await widgetApi.list();
    expect(apiClient.get).toHaveBeenCalledWith('/v1/widgets');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(WIDGET_ID);
  });

  it('throws on a malformed payload (contract drift)', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { widgets: [{ id: 1 }] } },
    });
    await expect(widgetApi.list()).rejects.toThrow();
  });
});

describe('widgetApi.getById / create', () => {
  it('getById unwraps the widget envelope', async () => {
    apiClient.get.mockResolvedValue({ data: { data: { widget } } });
    const result = await widgetApi.getById('w1');
    expect(apiClient.get).toHaveBeenCalledWith('/v1/widgets/w1');
    expect(result.name).toBe('My Widget');
  });

  it('create POSTs the input and returns the created widget', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { widget: { ...widget, name: 'New' } } },
    });
    const result = await widgetApi.create({ name: 'New' });
    expect(apiClient.post).toHaveBeenCalledWith('/v1/widgets', { name: 'New' });
    expect(result.name).toBe('New');
  });
});

describe('widgetApi.generateDescription / notify / remove', () => {
  it('generateDescription POSTs to the generate-description path', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { widget: { ...widget, description: 'AI' } } },
    });
    const result = await widgetApi.generateDescription('w1');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/widgets/w1/generate-description'
    );
    expect(result.description).toBe('AI');
  });

  it('notify returns the send result', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { sent: 2, invalidTokens: [] } },
    });
    const result = await widgetApi.notify('w1');
    expect(apiClient.post).toHaveBeenCalledWith('/v1/widgets/w1/notify');
    expect(result.sent).toBe(2);
  });

  it('remove DELETEs the widget', async () => {
    apiClient.delete.mockResolvedValue({ data: { data: { success: true } } });
    await widgetApi.remove('w1');
    expect(apiClient.delete).toHaveBeenCalledWith('/v1/widgets/w1');
  });
});

describe('widgetApi.getWidgetUsage', () => {
  it('returns the widget_creation counter from the usage list', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          usage: [
            {
              feature: 'widget_creation',
              used: 1,
              limit: 3,
              remaining: 2,
              resetsAt: 't',
              periodType: 'weekly',
            },
            {
              feature: 'llm_generation',
              used: 0,
              limit: 5,
              remaining: 5,
              resetsAt: 't',
              periodType: 'daily',
            },
          ],
        },
      },
    });
    const result = await widgetApi.getWidgetUsage();
    expect(apiClient.get).toHaveBeenCalledWith('/v1/subscription/usage');
    expect(result?.feature).toBe('widget_creation');
    expect(result?.remaining).toBe(2);
  });

  it('returns null when there is no widget_creation counter', async () => {
    apiClient.get.mockResolvedValue({ data: { data: { usage: [] } } });
    expect(await widgetApi.getWidgetUsage()).toBeNull();
  });
});

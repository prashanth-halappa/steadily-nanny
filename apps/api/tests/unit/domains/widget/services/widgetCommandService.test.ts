import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// mock.module() MUST run in beforeAll BEFORE the dynamic import of the service,
// so its bindings for gating / push / LLM resolve to the mocks.
let WidgetCommandService: any;
let requireUsageQuota: any;
let sendToUser: any;
let generateLlmObject: any;
let LlmGenerationErrorMock: any;

const owned = {
  id: 'w1',
  owner_id: 'u1',
  name: 'My Widget',
  description: null,
  tags: [] as string[],
  created_at: 't',
  updated_at: 't',
};

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    create: mock(async (data: any) => ({ ...owned, ...data, id: 'w-new' })),
    update: mock(async (id: string, data: any) => ({ ...owned, id, ...data })),
    delete: mock(async () => {}),
    findById: mock(async () => owned),
    findByOwnerId: mock(async () => [owned]),
    countCreatedSince: mock(async () => 0),
    ...overrides,
  } as any;
}

function makeQueries(overrides: Record<string, unknown> = {}) {
  return {
    getOwned: mock(async (ownerId: string, widgetId: string) => ({
      ...owned,
      id: widgetId,
      owner_id: ownerId,
    })),
    ...overrides,
  } as any;
}

beforeAll(async () => {
  class LlmGenerationError extends Error {
    metadata: unknown;
    constructor(message: string) {
      super(message);
      this.name = 'LlmGenerationError';
      this.metadata = { errorType: 'timeout', modelId: 'm', timedOut: true };
    }
  }
  LlmGenerationErrorMock = LlmGenerationError;

  mock.module(
    '../../../../../src/domains/subscription/services/entitlementGatingService',
    () => ({
      EntitlementGatingService: { requireUsageQuota: mock(async () => {}) },
    })
  );
  mock.module(
    '../../../../../src/domains/notification/services/pushDispatchService',
    () => ({ sendToUser: mock(async () => ({ sent: 1, invalidTokens: [] })) })
  );
  mock.module('../../../../../src/domains/llm/services/llmGenerate', () => ({
    generateLlmObject: mock(async () => ({
      object: { description: 'AI description', tags: ['ai', 'widget'] },
      usage: {},
    })),
    LlmGenerationError,
    logLlmGenerationFailure: mock(() => {}),
  }));

  WidgetCommandService = (
    await import(
      '../../../../../src/domains/widget/services/widgetCommandService'
    )
  ).WidgetCommandService;
  requireUsageQuota = (
    await import(
      '../../../../../src/domains/subscription/services/entitlementGatingService'
    )
  ).EntitlementGatingService.requireUsageQuota;
  sendToUser = (
    await import(
      '../../../../../src/domains/notification/services/pushDispatchService'
    )
  ).sendToUser;
  generateLlmObject = (
    await import('../../../../../src/domains/llm/services/llmGenerate')
  ).generateLlmObject;
});

beforeEach(() => {
  requireUsageQuota.mockClear?.();
  sendToUser.mockClear?.();
  generateLlmObject.mockClear?.();
  requireUsageQuota.mockImplementation(async () => {});
  generateLlmObject.mockImplementation(async () => ({
    object: { description: 'AI description', tags: ['ai', 'widget'] },
    usage: {},
  }));
});

describe('WidgetCommandService.create', () => {
  it('consumes the widget_creation quota BEFORE inserting', async () => {
    const repo = makeRepo();
    const svc = new WidgetCommandService(repo, makeQueries());
    const result = await svc.create('u1', { name: 'New' });

    expect(requireUsageQuota).toHaveBeenCalledWith('u1', 'widget_creation');
    expect(repo.create).toHaveBeenCalledWith({
      owner_id: 'u1',
      name: 'New',
      description: null,
      tags: [],
    });
    expect(result.name).toBe('New');
  });

  it('does not insert when the gate throws (paywall/limit)', async () => {
    requireUsageQuota.mockImplementation(async () => {
      throw new Error('PAYWALL_REQUIRED');
    });
    const repo = makeRepo();
    const svc = new WidgetCommandService(repo, makeQueries());

    await expect(svc.create('u1', { name: 'New' })).rejects.toThrow(
      'PAYWALL_REQUIRED'
    );
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('WidgetCommandService.generateDescription', () => {
  it('gates on llm_generation, persists the AI description + tags', async () => {
    const repo = makeRepo();
    const svc = new WidgetCommandService(repo, makeQueries());
    const result = await svc.generateDescription('u1', 'w1', 'Alex');

    expect(requireUsageQuota).toHaveBeenCalledWith('u1', 'llm_generation');
    expect(repo.update).toHaveBeenCalledWith('w1', {
      description: 'AI description',
      tags: ['ai', 'widget'],
    });
    expect(result.description).toBe('AI description');
  });

  it('degrades gracefully on LlmGenerationError (never throws, writes a fallback)', async () => {
    generateLlmObject.mockImplementation(async () => {
      throw new LlmGenerationErrorMock('timed out');
    });
    const repo = makeRepo();
    const svc = new WidgetCommandService(repo, makeQueries());

    const result = await svc.generateDescription('u1', 'w1', 'Alex');

    // Fallback description is deterministic and includes the widget name.
    expect(repo.update).toHaveBeenCalled();
    const [, updateArg] = repo.update.mock.calls[0];
    expect(updateArg.description).toContain('My Widget');
    expect(updateArg.tags).toEqual([]);
    expect(result.description).toContain('My Widget');
  });
});

describe('WidgetCommandService.notify', () => {
  it('sends a widget_ready push to the caller with a deep-link payload', async () => {
    const svc = new WidgetCommandService(makeRepo(), makeQueries());
    const result = await svc.notify('u1', 'w1');

    expect(sendToUser).toHaveBeenCalledTimes(1);
    const [userId, payload] = sendToUser.mock.calls[0];
    expect(userId).toBe('u1');
    expect(payload.title).toBe('Widget ready');
    expect(payload.data).toEqual({ type: 'widget_ready', widgetId: 'w1' });
    expect(result).toEqual({ sent: 1, invalidTokens: [] });
  });
});

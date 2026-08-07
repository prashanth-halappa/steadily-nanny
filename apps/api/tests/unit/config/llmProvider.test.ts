/**
 * F-B11-7: `llmProvider` has zero current callers, so `GOOGLE_VERTEX_PROJECT`
 * is optional at boot (see `env.core.ts`). The provider itself must still fail
 * loudly — just deferred to first use — naming the var so a future caller
 * gets a clear error instead of an opaque SDK failure.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

let llmProvider: typeof import('../../../src/config/llmProvider');

beforeAll(async () => {
  mock.module('../../../src/config/env', () => ({
    env: {
      GOOGLE_VERTEX_PROJECT: undefined,
      GOOGLE_VERTEX_LOCATION: 'us-central1',
    },
  }));
  llmProvider = await import('../../../src/config/llmProvider');
});

describe('llmProvider — lazy Vertex init', () => {
  it('throws a clear error naming GOOGLE_VERTEX_PROJECT when a model factory is called without it set', () => {
    expect(() => llmProvider.flashModel()).toThrow(/GOOGLE_VERTEX_PROJECT/);
  });
});

import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { z } from 'zod';
import type { LlmCallConfig } from '../../../../src/config/llmProvider';

// mock.module('ai', …) MUST run in beforeAll BEFORE the dynamic import of the
// module under test, so its `generateObject` binding resolves to the mock.
let generateLlmObject: any;

// Test-local call config — fast/cheap knobs, same shape as a real app.llmConfigs
// bundle, but not tied to any product feature.
const testLlmConfig: LlmCallConfig = {
  // Cast: the mocked 'ai' module never touches this value.
  model: {} as LlmCallConfig['model'],
  temperature: 0.5,
  maxOutputTokens: 300,
  timeoutMs: 8000,
  maxRetries: 2,
  disableThinking: true,
};

beforeAll(async () => {
  mock.module('ai', () => ({
    // Echo the (already PII-masked) prompt back as the object.
    generateObject: async ({ prompt }: { prompt: string }) => ({
      object: { text: prompt },
      usage: { totalTokens: 1 },
    }),
  }));
  ({ generateLlmObject } = await import(
    '../../../../src/domains/llm/services/llmGenerate'
  ));
});

describe('generateLlmObject', () => {
  test('maskAndUnmask: masks the outbound prompt and restores the name in output', async () => {
    const { object } = await generateLlmObject({
      config: testLlmConfig,
      schema: z.object({ text: z.string() }),
      prompt: 'Alex is happy',
      piiName: 'Alex',
      pii: 'maskAndUnmask',
    });
    // The mock returned the masked prompt ("[NAME] is happy"); unmask restores it.
    expect(object.text).toBe('Alex is happy');
  });

  test('none: passes the prompt through unmasked', async () => {
    const { object } = await generateLlmObject({
      config: testLlmConfig,
      schema: z.object({ text: z.string() }),
      prompt: 'no pii here',
    });
    expect(object.text).toBe('no pii here');
  });
});

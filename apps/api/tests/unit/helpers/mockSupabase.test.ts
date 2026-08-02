/**
 * Wave 0 — shared MockSupabase must expose thenable chains plus lt/not/rpc/upsert
 * so new repository tests stop re-rolling local createMockQueryChain helpers.
 */
import { describe, expect, it } from 'bun:test';
import { MockSupabase } from '../../helpers/mockSupabase';

describe('MockSupabase.createMockQueryChain', () => {
  it('is thenable and resolves to the final response', async () => {
    const response = MockSupabase.createSuccessResponse({ id: 'row-1' });
    const chain = MockSupabase.createMockQueryChain(response);

    expect(typeof chain.then).toBe('function');
    await expect(Promise.resolve(chain)).resolves.toEqual(response);
  });

  it('exposes lt, not, and upsert as chainable methods', () => {
    const chain = MockSupabase.createMockQueryChain(
      MockSupabase.createSuccessResponse(null)
    );

    expect(typeof chain.lt).toBe('function');
    expect(typeof chain.not).toBe('function');
    expect(typeof chain.upsert).toBe('function');

    expect(chain.lt('col', 'val')).toBe(chain);
    expect(chain.not('col', 'is', null)).toBe(chain);
    expect(chain.upsert([])).toBe(chain);
  });
});

describe('MockSupabase.createMockClient', () => {
  it('exposes rpc alongside from', async () => {
    const rpcResult = MockSupabase.createSuccessResponse({ outcome: 'ok' });
    const client = MockSupabase.createMockClient({
      rpcResponse: rpcResult,
    });

    expect(typeof client.from).toBe('function');
    expect(typeof client.rpc).toBe('function');

    await expect(client.rpc('any_fn', {})).resolves.toEqual(rpcResult);
  });
});

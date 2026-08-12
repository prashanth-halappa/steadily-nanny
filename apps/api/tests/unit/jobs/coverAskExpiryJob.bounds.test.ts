/**
 * F6 — `DefaultCoverAskExpirySource` must not reach back to the beginning of
 * time. The `starts_at.lte.now` arm matches every pending extra/cover shift
 * ever created, including pre-088 rows with a null deadline whose start is
 * months past; unbounded, the first tick after 088 ships pushes "Nobody is
 * booked for the ..." to every parent about all of them.
 *
 * Its own file because `mock.module` on the Supabase client must land before
 * the job module is imported, and the rest of the suite exercises the injected
 * seams instead.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

// biome-ignore lint/suspicious/noExplicitAny: mocked supabase client
let mockSupabaseService: any;
let listDueAsks: () => Promise<unknown>;
let EXPIRY_BATCH_LIMIT: number;
let EXPIRY_LOOKBACK_MS: number;

const calls: Array<{ method: string; args: unknown[] }> = [];

// biome-ignore lint/suspicious/noExplicitAny: mocked supabase chain
function createSupabaseQueryChain(): any {
  const record =
    (method: string) =>
    // biome-ignore lint/suspicious/noExplicitAny: mocked supabase chain
    (...args: unknown[]): any => {
      calls.push({ method, args });
      return chain;
    };
  // biome-ignore lint/suspicious/noExplicitAny: mocked supabase chain
  const chain: any = {
    select: record('select'),
    eq: record('eq'),
    in: record('in'),
    not: record('not'),
    or: record('or'),
    gte: record('gte'),
    order: record('order'),
    limit: record('limit'),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../src/config/supabase', () => {
    const obj = { from: mock(() => createSupabaseQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import('../../../src/jobs/coverAskExpiryJob');
  EXPIRY_BATCH_LIMIT = mod.EXPIRY_BATCH_LIMIT;
  EXPIRY_LOOKBACK_MS = mod.EXPIRY_LOOKBACK_MS;
  const source = new mod.DefaultCoverAskExpirySource();
  listDueAsks = () => source.listDueAsks(NOW);
  mockSupabaseService = (await import('../../../src/config/supabase'))
    .supabaseService;
});

const NOW = new Date('2026-08-14T03:05:00.000Z');

describe('DefaultCoverAskExpirySource — the sweep has a floor and a ceiling', () => {
  it('floors how far back it reaches, and caps the batch', async () => {
    calls.length = 0;
    await listDueAsks();

    expect(mockSupabaseService.from).toHaveBeenCalled();

    const floor = calls.find(
      c => c.method === 'gte' && c.args[0] === 'starts_at'
    );
    expect(floor?.args[1]).toBe(
      new Date(NOW.getTime() - EXPIRY_LOOKBACK_MS).toISOString()
    );

    const limit = calls.find(c => c.method === 'limit');
    expect(limit?.args[0]).toBe(EXPIRY_BATCH_LIMIT);

    // Oldest first, so a capped batch drains deterministically over the next
    // five-minute ticks instead of re-picking the same slice forever.
    const order = calls.find(c => c.method === 'order');
    expect(order?.args[0]).toBe('starts_at');
  });
});

// Canonical Supabase mock utilities for API tests.
import { mock } from 'bun:test';

export interface PostgrestError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}

export interface SupabaseResponse<T> {
  data: T | null;
  error: PostgrestError | null;
  status?: number;
  statusText?: string;
}

export interface MockClientOptions {
  /** Default response returned by `from()` query chains. */
  fromResponse?: SupabaseResponse<unknown>;
  /** Default response returned by `rpc()`. */
  rpcResponse?: SupabaseResponse<unknown>;
}

export const MockSupabase = {
  /** A chainable mock query with a predetermined terminal response. */
  createMockQueryChain<T>(finalResponse: SupabaseResponse<T>) {
    const chainable = function (this: unknown, ..._args: unknown[]) {
      return this;
    };
    const chain = {
      select: mock(chainable),
      insert: mock(chainable),
      update: mock(chainable),
      upsert: mock(chainable),
      delete: mock(chainable),
      eq: mock(chainable),
      in: mock(chainable),
      or: mock(chainable),
      gte: mock(chainable),
      lt: mock(chainable),
      not: mock(chainable),
      order: mock(chainable),
      limit: mock(chainable),
      single: mock(async () => finalResponse),
      maybeSingle: mock(async () => finalResponse),
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(finalResponse).then(resolve),
    };
    return chain;
  },

  /**
   * A mock supabaseService / supabase client with `from` + `rpc`.
   * New repository tests that call RPCs should use this instead of
   * rolling a local `{ from }` stub.
   */
  createMockClient(options: MockClientOptions = {}) {
    const fromResponse =
      options.fromResponse ?? MockSupabase.createSuccessResponse(null);
    const rpcResponse =
      options.rpcResponse ?? MockSupabase.createSuccessResponse(null);

    return {
      from: mock((..._args: unknown[]) =>
        MockSupabase.createMockQueryChain(fromResponse)
      ),
      rpc: mock(async (..._args: unknown[]) => rpcResponse),
    };
  },

  createSuccessResponse<T>(data: T): SupabaseResponse<T> {
    return { data, error: null, status: 200, statusText: 'OK' };
  },

  createErrorResponse(message: string, code?: string): SupabaseResponse<null> {
    return {
      data: null,
      error: { message, code: code || 'MOCK_ERROR', details: null, hint: null },
      status: 400,
      statusText: 'Bad Request',
    };
  },
};

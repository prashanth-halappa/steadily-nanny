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

export const MockSupabase = {
  /** A chainable mock query with a predetermined terminal response. */
  createMockQueryChain<T>(finalResponse: SupabaseResponse<T>) {
    const chain = {
      select: mock(function (this: unknown) {
        return this;
      }),
      insert: mock(function (this: unknown) {
        return this;
      }),
      update: mock(function (this: unknown) {
        return this;
      }),
      upsert: mock(function (this: unknown) {
        return this;
      }),
      delete: mock(function (this: unknown) {
        return this;
      }),
      eq: mock(function (this: unknown) {
        return this;
      }),
      in: mock(function (this: unknown) {
        return this;
      }),
      or: mock(function (this: unknown) {
        return this;
      }),
      gte: mock(function (this: unknown) {
        return this;
      }),
      order: mock(function (this: unknown) {
        return this;
      }),
      limit: mock(function (this: unknown) {
        return this;
      }),
      single: mock(async () => finalResponse),
      maybeSingle: mock(async () => finalResponse),
    };
    return chain;
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

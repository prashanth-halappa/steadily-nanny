/**
 * TanStack Query test mocks — helpers to mock query/mutation results and a
 * lightweight fake QueryClient.
 */

import { mock } from 'bun:test';
import { createMockMutationResult, createMockQueryResult } from '../setup';

export function createMockQueryClient() {
  return {
    getQueryData: mock(() => undefined),
    setQueryData: mock(() => {}),
    invalidateQueries: mock(() => Promise.resolve()),
    prefetchQuery: mock(() => Promise.resolve()),
    cancelQueries: mock(() => Promise.resolve()),
    clear: mock(() => {}),
    getQueryCache: mock(() => ({
      find: mock(() => undefined),
      findAll: mock(() => []),
      clear: mock(() => {}),
    })),
    getMutationCache: mock(() => ({
      find: mock(() => undefined),
      findAll: mock(() => []),
      clear: mock(() => {}),
    })),
    defaultQueryOptions: mock(() => ({})),
  };
}

export function mockQueryHook<T>(
  _hookName: string,
  result: {
    data?: T;
    isLoading?: boolean;
    isError?: boolean;
    error?: Error | null;
    isFetching?: boolean;
    refetch?: () => void;
  }
) {
  return mock(() => createMockQueryResult(result.data, result));
}

export function mockMutationHook<TData = unknown, TVariables = unknown>(
  _hookName: string,
  result: {
    isLoading?: boolean;
    isError?: boolean;
    isSuccess?: boolean;
    error?: Error | null;
    data?: TData;
    mutate?: (variables: TVariables) => void;
    mutateAsync?: (variables: TVariables) => Promise<TData>;
  } = {}
) {
  return mock(() => createMockMutationResult<TData, TVariables>(result));
}

/** Generic mock data factories — replace/extend with your domain shapes. */
export const mockDataFactories = {
  user: (
    overrides: Partial<{
      id: string;
      email: string;
      name: string;
    }> = {}
  ) => ({
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides,
  }),
};

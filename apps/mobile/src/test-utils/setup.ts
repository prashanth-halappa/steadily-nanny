/**
 * Common test setup — re-exports from bun:test + @testing-library/react-native
 * plus small helpers for mocking TanStack Query results.
 *
 * Bun patterns:
 * - mock.module() must be called before imports (in beforeAll)
 * - use dynamic imports after mocking
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';

export { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn };

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

export { act, cleanup, fireEvent, render, screen, waitFor };

/** Standard cleanup after each test. */
export function setupTestEnvironment() {
  afterEach(() => {
    cleanup();
  });
}

/** Mock TanStack Query hook result. */
export function createMockQueryResult<T>(
  data: T | undefined,
  options: {
    isLoading?: boolean;
    isError?: boolean;
    error?: Error | null;
    isFetching?: boolean;
    isSuccess?: boolean;
    refetch?: () => void;
  } = {}
) {
  return {
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: options.error ?? null,
    isFetching: options.isFetching ?? false,
    isSuccess: options.isSuccess ?? (data !== undefined && !options.isError),
    refetch: options.refetch ?? mock(() => Promise.resolve({ data })),
    status: options.isLoading
      ? 'pending'
      : options.isError
        ? 'error'
        : 'success',
  };
}

/** Mock TanStack Query mutation result. */
export function createMockMutationResult<TData = unknown, TVariables = unknown>(
  options: {
    isLoading?: boolean;
    isError?: boolean;
    isSuccess?: boolean;
    error?: Error | null;
    data?: TData;
    mutate?: (variables: TVariables) => void;
    mutateAsync?: (variables: TVariables) => Promise<TData>;
  } = {}
) {
  const mutateFn = options.mutate ?? mock(() => {});
  const mutateAsyncFn =
    options.mutateAsync ?? mock(() => Promise.resolve(options.data as TData));

  return {
    mutate: mutateFn,
    mutateAsync: mutateAsyncFn,
    isLoading: options.isLoading ?? false,
    isPending: options.isLoading ?? false,
    isError: options.isError ?? false,
    isSuccess: options.isSuccess ?? false,
    error: options.error ?? null,
    data: options.data,
    reset: mock(() => {}),
    status: options.isLoading
      ? 'pending'
      : options.isError
        ? 'error'
        : options.isSuccess
          ? 'success'
          : 'idle',
  };
}

/** Wait for async operations with a timeout. */
export async function waitForAsync(callback: () => void, timeout = 5000) {
  await waitFor(callback, { timeout });
}

/** Type for mock functions. */
export type MockFn<
  T extends (...args: any[]) => any = (...args: any[]) => any,
> = ReturnType<typeof mock<T>>;

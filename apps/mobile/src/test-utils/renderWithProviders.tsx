/**
 * Render harness for provider-wrapped component and hook tests.
 * Centralizes the QueryClientProvider wrapper.
 *
 *   import { renderHookWithProviders } from '@/src/test-utils';
 *   const { result, queryClient } = renderHookWithProviders(() => useMyHook());
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook } from '@testing-library/react-native';
import React from 'react';

/** A QueryClient tuned for tests: no retries, no gc leakage between tests. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function buildWrapper(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'TestQueryClientProvider';
  return Wrapper;
}

/** Render a component wrapped in QueryClientProvider. */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: { queryClient?: QueryClient }
) {
  const queryClient = options?.queryClient ?? createTestQueryClient();
  const result = render(ui, { wrapper: buildWrapper(queryClient) });
  return { ...result, queryClient };
}

/** renderHook variant wrapped in QueryClientProvider (fresh client per call). */
export function renderHookWithProviders<TResult>(
  renderHookCallback: () => TResult,
  options?: { queryClient?: QueryClient }
) {
  const queryClient = options?.queryClient ?? createTestQueryClient();
  const hookResult = renderHook(renderHookCallback, {
    wrapper: buildWrapper(queryClient),
  });
  return { ...hookResult, queryClient };
}

/**
 * Serializes a react-test-renderer JSON tree to a string safely.
 *
 * Prevents `TypeError: JSON.stringify cannot serialize cyclic structures` when
 * React elements (such as `RefreshControl` in `<ScrollView refreshControl={...}>`)
 * are attached to component props. React elements carry an `_owner` fiber reference
 * which introduces cyclic references into `toJSON()` prop trees.
 *
 * Tracks ancestor paths rather than a global set of seen objects so that shared,
 * non-cyclic object references in sibling branches (e.g. frozen style objects,
 * memoized props, or shared constants) are fully serialized in all positions
 * rather than being lossily dropped.
 */
export function serializeTree(tree: unknown): string {
  const stack: object[] = [];
  return JSON.stringify(
    tree,
    function (this: unknown, key: string, value: unknown) {
      if (key === '_owner' || key === '_store') {
        return undefined;
      }
      if (typeof value === 'object' && value !== null) {
        while (stack.length > 0 && stack[stack.length - 1] !== this) {
          stack.pop();
        }
        if (stack.includes(value)) {
          return undefined;
        }
        stack.push(value);
      }
      return value;
    }
  );
}

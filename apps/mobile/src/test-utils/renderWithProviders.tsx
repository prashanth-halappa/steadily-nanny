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

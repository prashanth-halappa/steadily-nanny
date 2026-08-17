import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react-native';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';
import { usePullToRefresh } from '../usePullToRefresh';

describe('usePullToRefresh', () => {
  it('does not throw and functions correctly without a QueryClientProvider', async () => {
    expect(() => renderHook(() => usePullToRefresh())).not.toThrow();

    const { result } = renderHook(() => usePullToRefresh());

    expect(result.current.refreshing).toBe(false);

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(result.current.refreshing).toBe(false);
  });

  it('initializes refreshing as false', () => {
    const { result } = renderHookWithProviders(() => usePullToRefresh());
    expect(result.current.refreshing).toBe(false);
  });

  it('sets refreshing to true while onRefresh is in flight and false after it resolves', async () => {
    let resolveRefetch: () => void = () => {};
    const queryClient = createTestQueryClient();
    (queryClient as any).refetchQueries = mock(() => {
      return new Promise<void>(resolve => {
        resolveRefetch = resolve;
      });
    });

    const { result } = renderHookWithProviders(() => usePullToRefresh(), {
      queryClient,
    });

    expect(result.current.refreshing).toBe(false);

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.onRefresh();
    });

    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      resolveRefetch();
      await refreshPromise;
    });

    expect(result.current.refreshing).toBe(false);
  });

  it('calls queryClient.refetchQueries with type active', async () => {
    const queryClient = createTestQueryClient();
    const refetchSpy = mock(() => Promise.resolve());
    (queryClient as any).refetchQueries = refetchSpy;

    const { result } = renderHookWithProviders(() => usePullToRefresh(), {
      queryClient,
    });

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(refetchSpy).toHaveBeenCalledWith({ type: 'active' });
  });

  it('returns a valid React element for refreshControl', () => {
    const { result } = renderHookWithProviders(() => usePullToRefresh());
    const { refreshControl } = result.current;

    expect(refreshControl).toBeDefined();
    expect(refreshControl.type).toBe('RefreshControl');
    expect(refreshControl.props.refreshing).toBe(false);
  });

  it('resets refreshing to false even if refetchQueries rejects', async () => {
    const queryClient = createTestQueryClient();
    (queryClient as any).refetchQueries = mock(() =>
      Promise.reject(new Error('Refetch failed'))
    );

    const { result } = renderHookWithProviders(() => usePullToRefresh(), {
      queryClient,
    });

    expect(result.current.refreshing).toBe(false);

    await act(async () => {
      try {
        await result.current.onRefresh();
      } catch {
        // expected rejection
      }
    });

    expect(result.current.refreshing).toBe(false);
  });
});

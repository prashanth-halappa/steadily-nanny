/**
 * @module domains/schedule/hooks/__tests__/useCalendarSync.test
 */
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

const runDefaultCalendarSync = mock(() => Promise.resolve());

mock.module('@/src/domains/schedule/utils/calendarSyncNative', () => ({
  runDefaultCalendarSync,
}));

let requestCalendarSync: typeof import('../useCalendarSync').requestCalendarSync;
let useCalendarSync: typeof import('../useCalendarSync').useCalendarSync;
let flushCalendarSyncForTests: typeof import('../useCalendarSync').flushCalendarSyncForTests;
let resetCalendarSyncStateForTests: typeof import('../useCalendarSync').resetCalendarSyncStateForTests;

beforeAll(async () => {
  const mod = await import('../useCalendarSync');
  requestCalendarSync = mod.requestCalendarSync;
  useCalendarSync = mod.useCalendarSync;
  flushCalendarSyncForTests = mod.flushCalendarSyncForTests;
  resetCalendarSyncStateForTests = mod.resetCalendarSyncStateForTests;
});

afterEach(async () => {
  await resetCalendarSyncStateForTests();
  runDefaultCalendarSync.mockClear();
  runDefaultCalendarSync.mockImplementation(() => Promise.resolve());
});

describe('requestCalendarSync', () => {
  it('debounces and then runs the sync', async () => {
    requestCalendarSync();
    requestCalendarSync();
    expect(runDefaultCalendarSync).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
    });

    expect(runDefaultCalendarSync).toHaveBeenCalledTimes(1);
  });

  it('reruns once when a request arrives during an in-flight sync', async () => {
    let resolveFirst: (() => void) | null = null;
    runDefaultCalendarSync.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveFirst = resolve;
        })
    );
    runDefaultCalendarSync.mockImplementationOnce(() => Promise.resolve());

    requestCalendarSync();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
    });
    expect(runDefaultCalendarSync).toHaveBeenCalledTimes(1);

    // Mid-flight request — must queue a follow-up, not drop.
    requestCalendarSync();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
    });
    expect(runDefaultCalendarSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(runDefaultCalendarSync).toHaveBeenCalledTimes(2);
  });
});

describe('useCalendarSync', () => {
  it('requests a sync on mount without an AppState event (cold start)', async () => {
    const addEventListenerMock = AppState.addEventListener as unknown as {
      mockImplementation: (fn: (...args: unknown[]) => unknown) => void;
      mockClear: () => void;
    };
    addEventListenerMock.mockClear?.();
    addEventListenerMock.mockImplementation(() => ({
      remove: mock(() => {}),
    }));

    renderHook(() => useCalendarSync());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
    });

    expect(runDefaultCalendarSync).toHaveBeenCalled();
  });

  it('requests a sync when AppState becomes active', async () => {
    type Listener = (status: string) => void;
    const captured: { listener: Listener | null } = { listener: null };

    const addEventListenerMock = AppState.addEventListener as unknown as {
      mockImplementation: (fn: (...args: unknown[]) => unknown) => void;
      mockClear: () => void;
    };

    addEventListenerMock.mockClear?.();
    addEventListenerMock.mockImplementation((event: unknown, cb: unknown) => {
      if (event === 'change') captured.listener = cb as Listener;
      return { remove: mock(() => {}) };
    });

    renderHook(() => useCalendarSync());

    // Clear the cold-start call so we can assert the AppState path alone.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
    });
    runDefaultCalendarSync.mockClear();

    expect(captured.listener).not.toBeNull();
    captured.listener?.('active');

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
    });

    expect(runDefaultCalendarSync).toHaveBeenCalled();
  });
});

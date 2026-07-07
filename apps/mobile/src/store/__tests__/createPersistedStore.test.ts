import { describe, expect, it } from 'bun:test';
import { createPersistedStore } from '../createPersistedStore';

interface CounterState {
  count: number;
  inc: () => void;
  setCount: (n: number) => void;
}

const init =
  (): Parameters<typeof createPersistedStore<CounterState>>[0] => set => ({
    count: 0,
    inc: () => set(s => ({ count: s.count + 1 })),
    setCount: (n: number) => set({ count: n }),
  });

describe('createPersistedStore', () => {
  it('creates a working zustand store with initial state + actions', () => {
    const useStore = createPersistedStore<CounterState>(init(), {
      name: 'test-counter',
    });
    expect(useStore.getState().count).toBe(0);
    useStore.getState().inc();
    expect(useStore.getState().count).toBe(1);
    useStore.getState().setCount(5);
    expect(useStore.getState().count).toBe(5);
  });

  it('wires the persist middleware with the given name + version', () => {
    const useStore = createPersistedStore<CounterState>(init(), {
      name: 'persist-key-test',
      version: 3,
    });
    expect(useStore.persist.getOptions().name).toBe('persist-key-test');
    expect(useStore.persist.getOptions().version).toBe(3);
  });

  it('supports the encrypted (secure) storage path', () => {
    const useStore = createPersistedStore<CounterState>(init(), {
      name: 'secure-counter',
      secure: true,
    });
    useStore.getState().setCount(9);
    expect(useStore.getState().count).toBe(9);
  });
});

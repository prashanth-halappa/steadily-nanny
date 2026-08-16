/**
 * @module domains/today/__tests__/useMomentOnce.test
 *
 * `useMomentOnce` is the explicit "show this moment for the whole mount,
 * never again" gate. The existing joined-household card relied on a Zustand
 * selector that happened not to re-render when the key was written; this
 * hook makes that snapshot a `useState` initializer so a later store write
 * cannot hide the card mid-mount.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useTodayCardDismissalStore } from '@/src/store/todayCardDismissalStore';
import { useMomentOnce } from '../hooks/useMomentOnce';

beforeEach(() => {
  useTodayCardDismissalStore.getState().reset();
});

describe('useMomentOnce', () => {
  it('returns true on first mount for an unseen key and persists the key', async () => {
    const { result } = renderHook(() => useMomentOnce('moment:first'));

    expect(result.current).toBe(true);
    await waitFor(() => {
      expect(
        useTodayCardDismissalStore.getState().isDismissed('moment:first')
      ).toBe(true);
    });
  });

  it('returns false on a later mount of the same key', async () => {
    const first = renderHook(() => useMomentOnce('moment:again'));
    await waitFor(() => {
      expect(
        useTodayCardDismissalStore.getState().isDismissed('moment:again')
      ).toBe(true);
    });
    first.unmount();

    const second = renderHook(() => useMomentOnce('moment:again'));
    expect(second.result.current).toBe(false);
  });

  it('returns false for a null key and writes nothing', async () => {
    const { result } = renderHook(() => useMomentOnce(null));

    expect(result.current).toBe(false);
    await act(async () => {});
    expect(useTodayCardDismissalStore.getState().dismissedKeys).toEqual({});
  });

  it('stays true for the whole mount even after the store changes', async () => {
    const { result } = renderHook(() => useMomentOnce('moment:sticky'));

    expect(result.current).toBe(true);
    await waitFor(() => {
      expect(
        useTodayCardDismissalStore.getState().isDismissed('moment:sticky')
      ).toBe(true);
    });
    act(() => {
      useTodayCardDismissalStore.getState().dismiss('moment:other');
    });
    expect(result.current).toBe(true);
  });
});

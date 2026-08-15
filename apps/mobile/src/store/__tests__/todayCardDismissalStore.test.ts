import { beforeEach, describe, expect, it } from 'bun:test';
import { useTodayCardDismissalStore } from '../todayCardDismissalStore';

beforeEach(() => {
  useTodayCardDismissalStore.getState().reset();
});

describe('useTodayCardDismissalStore', () => {
  it('reports a key as not dismissed until dismiss() is called', () => {
    expect(useTodayCardDismissalStore.getState().isDismissed('a')).toBe(false);
    useTodayCardDismissalStore.getState().dismiss('a');
    expect(useTodayCardDismissalStore.getState().isDismissed('a')).toBe(true);
  });

  it('keeps dismissals independent per key', () => {
    useTodayCardDismissalStore.getState().dismiss('a');
    expect(useTodayCardDismissalStore.getState().isDismissed('b')).toBe(false);
  });

  it('reset() clears every dismissal', () => {
    useTodayCardDismissalStore.getState().dismiss('a');
    useTodayCardDismissalStore.getState().reset();
    expect(useTodayCardDismissalStore.getState().isDismissed('a')).toBe(false);
  });
});

/**
 * @module lib/__tests__/goBack.test
 *
 * `router.back()` is a no-op at the bottom of a stack, which is where a
 * reload or a deep link lands. That stranded a nanny on the draft terms
 * form: Back did nothing and a successful save left her on the same filled
 * form, indistinguishable from a failure.
 */
import { describe, expect, it, mock } from 'bun:test';
import { goBackOrHome } from '../goBack';

function router(canGoBack: boolean) {
  return {
    canGoBack: () => canGoBack,
    back: mock(() => {}),
    replace: mock((_href: unknown) => {}),
  };
}

describe('goBackOrHome', () => {
  it('goes back when there is somewhere to go back to', () => {
    const r = router(true);
    goBackOrHome(r as never);
    expect(r.back).toHaveBeenCalled();
    expect(r.replace).not.toHaveBeenCalled();
  });

  it('lands on home instead of no-oping at the bottom of the stack', () => {
    const r = router(false);
    goBackOrHome(r as never);
    expect(r.back).not.toHaveBeenCalled();
    expect(r.replace).toHaveBeenCalledWith('/(private)/(tabs)/home');
  });
});

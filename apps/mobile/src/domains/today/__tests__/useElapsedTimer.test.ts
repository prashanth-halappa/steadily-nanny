/**
 * @module domains/today/__tests__/useElapsedTimer.test
 *
 * The interval cleanup is the load-bearing behavior here — a leaked timer
 * would keep re-rendering (and keep a stale closure alive) long after the
 * clock-in card that created it is gone. Per team-lead's brief: "a test for
 * cleanup is worth more than one asserting the format," so that gets three
 * cases; the format itself gets one sanity check.
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { renderHook } from '@testing-library/react-native';
import { useElapsedTimer } from '../hooks/useElapsedTimer';

describe('useElapsedTimer', () => {
  it('does not start an interval when there is no running start time', () => {
    const setIntervalSpy = spyOn(global, 'setInterval');
    renderHook(() => useElapsedTimer(null));

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('clears its interval on unmount — no leaked timer', () => {
    const clearIntervalSpy = spyOn(global, 'clearInterval');
    const { unmount } = renderHook(() =>
      useElapsedTimer('2026-08-01T07:58:00.000Z')
    );

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    clearIntervalSpy.mockRestore();
  });

  it('clears the previous interval when startIso changes, not only on unmount', () => {
    const clearIntervalSpy = spyOn(global, 'clearInterval');
    const { rerender } = renderHook(
      ({ startIso }: { startIso: string | null }) => useElapsedTimer(startIso),
      { initialProps: { startIso: '2026-08-01T07:58:00.000Z' } }
    );

    rerender({ startIso: '2026-08-01T09:00:00.000Z' });

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    clearIntervalSpy.mockRestore();
  });

  it('starts exactly one interval for a running entry, not one per render', () => {
    const setIntervalSpy = spyOn(global, 'setInterval');
    const { rerender } = renderHook(
      ({ startIso }: { startIso: string | null }) => useElapsedTimer(startIso),
      { initialProps: { startIso: '2026-08-01T07:58:00.000Z' } }
    );

    // Re-render with the SAME startIso — must not re-arm the interval.
    rerender({ startIso: '2026-08-01T07:58:00.000Z' });
    rerender({ startIso: '2026-08-01T07:58:00.000Z' });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });

  it('returns null when nothing is running', () => {
    const { result } = renderHook(() => useElapsedTimer(null));
    expect(result.current).toBeNull();
  });

  it('returns a formatted elapsed string once running', () => {
    const { result } = renderHook(() =>
      useElapsedTimer('2026-08-01T07:58:00.000Z')
    );
    expect(typeof result.current).toBe('string');
    expect(result.current).toMatch(/^\d+[hm]/);
  });
});

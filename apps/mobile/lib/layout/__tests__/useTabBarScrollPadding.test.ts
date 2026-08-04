/**
 * @module lib/layout/__tests__/useTabBarScrollPadding.test
 *
 * This hook existed unused since the original template scaffold (its
 * comment referenced a "CustomTabBar" this app never built) — nothing
 * imported it, so no scroll container ever actually cleared the tab bar.
 * That's the root cause of the Settings tap-through dead zone: the last
 * rows sat exactly where the floating tab bar could intercept taps for
 * them. Now it's wired into every scrollable tab screen; this pins the
 * value so a future edit can't silently shrink it back below what the
 * real tab bar + safe area need.
 */
import { describe, expect, it } from 'bun:test';
import { renderHook } from '@testing-library/react-native';
import { useTabBarScrollPadding } from '../useTabBarScrollPadding';

describe('useTabBarScrollPadding', () => {
  it('reserves the tab bar height plus the bottom safe-area inset plus scroll-end clearance', () => {
    // bun.setup.ts mocks useSafeAreaInsets() to { bottom: 34, ... }.
    const { result } = renderHook(() => useTabBarScrollPadding());

    expect(result.current).toBe(56 + 34 + 24);
    // Comfortably clears the reported dead zone: a tab bar starting at
    // y≈873 with rows resting at y≈882–926 needed ~53px more clearance
    // than the previous hardcoded SCREEN_CONTENT_STYLE.paddingBottom (100)
    // gave when unscrolled.
    expect(result.current).toBeGreaterThan(53);
  });
});

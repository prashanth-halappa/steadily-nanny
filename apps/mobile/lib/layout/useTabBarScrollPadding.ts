import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Approximate height of the native bottom tab bar rendered by
 * `app/(private)/(tabs)/_layout.tsx`'s `<Tabs>` (React Navigation's default
 * bottom-tabs, no custom floating bar in this app) — the bar's own chrome,
 * BEFORE the device safe-area inset (added separately below).
 */
const TAB_BAR_HEIGHT = 56;

/** Extra clearance above the tab bar for a comfortable scroll end. */
const TAB_BAR_SCROLL_EXTRA = 24;

/**
 * Bottom padding for scrollable tab screens so their last row can never end
 * up under the tab bar. React Navigation's bottom-tabs renders each tab's
 * content as a full-height view with the tab bar overlaid at the bottom —
 * it does NOT automatically shrink a screen's `ScrollView`/`FlashList` to
 * leave room, so every scrollable tab screen must reserve this much space
 * itself (see `useBottomTabBarHeight` in React Navigation's own docs for the
 * same gotcha). Without it, a screen whose content is just tall enough to
 * reach the bar — but not tall enough to scroll much further — strands its
 * last row in a dead zone: taps land on the tab bar underneath instead of
 * the row, and there is no way to scroll it clear (GOLDEN-FIXES.md-class bug,
 * first found in Settings).
 */
export function useTabBarScrollPadding(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + insets.bottom + TAB_BAR_SCROLL_EXTRA;
}

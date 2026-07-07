import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Matches CustomTabBar TAB_BAR_HEIGHT */
const TAB_BAR_HEIGHT = 56;

/** Extra space above tab bar for FAB shadow and comfortable scroll end */
const TAB_BAR_SCROLL_EXTRA = 24;

/**
 * Bottom padding for scrollable tab screens so content clears the custom tab bar + FAB.
 */
export function useTabBarScrollPadding(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + insets.bottom + TAB_BAR_SCROLL_EXTRA;
}

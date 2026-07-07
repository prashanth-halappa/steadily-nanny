/**
 * useTrackScreen Hook
 *
 * Automatically tracks screen views when a component mounts.
 * Use this hook in screen components to track page views.
 *
 * Usage:
 * ```tsx
 * function MyScreen() {
 *   useTrackScreen('MyScreen', { additional: 'properties' });
 *   return <View>...</View>;
 * }
 * ```
 */

import { useEffect, useRef } from 'react';
import { useAnalytics } from './useAnalytics';

/**
 * Hook to track screen views
 *
 * @param screenName Name of the screen to track
 * @param properties Additional properties to include
 */
export function useTrackScreen(
  screenName: string,
  properties?: Record<string, unknown>
): void {
  const analytics = useAnalytics();
  const hasTracked = useRef(false);

  useEffect(() => {
    // Only track once per mount
    if (!hasTracked.current && analytics.isReady) {
      // Update context with current screen
      analytics.updateContext({
        screen: {
          current: screenName,
        },
      });

      // Track screen view
      analytics.trackScreen(screenName, properties);
      hasTracked.current = true;
    }
  }, [analytics, screenName, properties]);

  // Reset hasTracked on unmount to allow re-tracking on remount
  useEffect(() => {
    return () => {
      hasTracked.current = false;
    };
  }, []);
}

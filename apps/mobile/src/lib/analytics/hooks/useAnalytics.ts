/**
 * useAnalytics Hook
 *
 * Main hook for accessing analytics functionality.
 * Wraps useAnalyticsContext for convenient access.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const analytics = useAnalytics();
 *
 *   const handleClick = () => {
 *     analytics.track('button_clicked', { button_name: 'submit' });
 *   };
 *
 *   return <Button onPress={handleClick}>Submit</Button>;
 * }
 * ```
 */

import { useAnalyticsContext } from '../core/AnalyticsContext';
import type { AnalyticsContextValue } from '../core/types';

/**
 * Hook to access analytics functionality
 *
 * @returns Analytics context value with track, identify, and other methods
 */
export function useAnalytics(): AnalyticsContextValue {
  return useAnalyticsContext();
}

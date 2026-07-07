/**
 * Analytics Context
 *
 * React context for providing analytics functionality throughout the app.
 * Used by useAnalytics hook to access tracking methods.
 */

import { createContext, useContext } from 'react';
import type { AnalyticsContextValue } from './types';

/**
 * Default context value (no-op implementations)
 * Used when AnalyticsProvider is not present
 */
const defaultContextValue: AnalyticsContextValue = {
  track: () => {
    if (__DEV__)
      console.warn('Analytics: track called without AnalyticsProvider');
  },
  trackScreen: () => {
    if (__DEV__)
      console.warn('Analytics: trackScreen called without AnalyticsProvider');
  },
  identify: () => {
    if (__DEV__)
      console.warn('Analytics: identify called without AnalyticsProvider');
  },
  reset: () => {
    if (__DEV__)
      console.warn('Analytics: reset called without AnalyticsProvider');
  },
  startTimer: () => {
    if (__DEV__)
      console.warn('Analytics: startTimer called without AnalyticsProvider');
  },
  endTimer: () => {
    if (__DEV__)
      console.warn('Analytics: endTimer called without AnalyticsProvider');
  },
  getTimerDuration: () => null,
  cancelTimer: () => {
    if (__DEV__)
      console.warn('Analytics: cancelTimer called without AnalyticsProvider');
  },
  getContext: () => ({}),
  updateContext: () => {
    if (__DEV__)
      console.warn('Analytics: updateContext called without AnalyticsProvider');
  },
  isReady: false,
};

/**
 * Analytics React Context
 */
export const AnalyticsContext =
  createContext<AnalyticsContextValue>(defaultContextValue);

/**
 * Hook to access analytics context
 * Warns (but does not throw) if used outside of AnalyticsProvider so calls
 * degrade to no-ops.
 */
export function useAnalyticsContext(): AnalyticsContextValue {
  const context = useContext(AnalyticsContext);

  if (context === defaultContextValue) {
    // In development, warn but don't throw to allow graceful degradation
    if (__DEV__) {
      console.warn(
        'useAnalyticsContext: No AnalyticsProvider found. Analytics calls will be no-ops.'
      );
    }
  }

  return context;
}

/**
 * Display name for React DevTools
 */
AnalyticsContext.displayName = 'AnalyticsContext';

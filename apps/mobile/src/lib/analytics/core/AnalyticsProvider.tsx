/**
 * Analytics Provider
 *
 * Main provider component that wraps the app and provides analytics context.
 * Integrates with PostHog, manages plugins, and handles timer functionality.
 *
 * Place this INSIDE a `<PostHogProvider client={posthogClient}>` (see
 * `./client`) so the hook-based provider and the module-level `analytics`
 * singleton share one PostHog client.
 */

import type { PostHogEventProperties } from '@posthog/core';
import { usePostHog } from 'posthog-react-native';
import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { AnalyticsContext } from './AnalyticsContext';
import type {
  AnalyticsConfig,
  AnalyticsContext as AnalyticsContextType,
  AnalyticsContextValue,
  AnalyticsEvent,
  AnalyticsProviderProps,
  TimerEntry,
} from './types';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<AnalyticsConfig> = {
  enableDebugLogging: __DEV__,
  enableValidation: __DEV__,
  enableAutoEnrichment: true,
  maxQueueSize: 50,
};

/**
 * AnalyticsProvider component
 *
 * Provides analytics functionality to the entire app via React context.
 * Must be placed inside PostHogProvider.
 */
export function AnalyticsProvider({
  children,
  plugins = [],
  config = {},
}: AnalyticsProviderProps): React.ReactElement {
  const posthog = usePostHog();

  // Merge config with defaults
  const mergedConfig = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...config }),
    [config]
  );

  // Analytics context state
  const [analyticsContext, setAnalyticsContext] =
    useState<AnalyticsContextType>({});

  // Timer storage (using ref to avoid re-renders)
  const timersRef = useRef<Map<string, TimerEntry>>(new Map());

  /**
   * Debug logger helper
   */
  const debugLog = useCallback(
    (message: string, data?: unknown) => {
      if (mergedConfig.enableDebugLogging) {
        console.log(`Analytics: ${message}`, data ?? '');
      }
    },
    [mergedConfig.enableDebugLogging]
  );

  /**
   * Run event through plugin pipeline
   */
  const runPluginPipeline = useCallback(
    (
      event: AnalyticsEvent,
      context: AnalyticsContextType
    ): AnalyticsEvent | null => {
      let processedEvent: AnalyticsEvent | null = event;

      for (const plugin of plugins) {
        if (!processedEvent) break;

        if (plugin.beforeTrack) {
          try {
            processedEvent = plugin.beforeTrack(processedEvent, context);
          } catch (error) {
            if (__DEV__)
              console.error(`Plugin ${plugin.name} beforeTrack error:`, error);
            plugin.onError?.(error as Error, event);
          }
        }
      }

      return processedEvent;
    },
    [plugins]
  );

  /**
   * Run afterTrack for all plugins
   */
  const runAfterTrack = useCallback(
    (event: AnalyticsEvent, context: AnalyticsContextType) => {
      for (const plugin of plugins) {
        if (plugin.afterTrack) {
          try {
            plugin.afterTrack(event, context);
          } catch (error) {
            if (__DEV__)
              console.error(`Plugin ${plugin.name} afterTrack error:`, error);
            plugin.onError?.(error as Error, event);
          }
        }
      }
    },
    [plugins]
  );

  /**
   * Track an analytics event
   */
  const track = useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      const event: AnalyticsEvent = {
        name: eventName,
        properties: properties ?? {},
        timestamp: Date.now(),
      };

      // Run through plugin pipeline
      const processedEvent = runPluginPipeline(event, analyticsContext);

      // If plugin cancelled the event, don't track
      if (!processedEvent) {
        debugLog(`Event cancelled by plugin: ${eventName}`);
        return;
      }

      debugLog(`Event: ${processedEvent.name}`, processedEvent.properties);

      // Send to PostHog
      if (posthog) {
        try {
          posthog.capture(
            processedEvent.name,
            processedEvent.properties as unknown as PostHogEventProperties
          );
          runAfterTrack(processedEvent, analyticsContext);
        } catch (error) {
          if (__DEV__) console.error('PostHog capture error:', error);
        }
      }
    },
    [posthog, analyticsContext, runPluginPipeline, runAfterTrack, debugLog]
  );

  /**
   * Track a screen view
   */
  const trackScreen = useCallback(
    (screenName: string, properties?: Record<string, unknown>) => {
      const event: AnalyticsEvent = {
        name: `screen_viewed`,
        properties: { screen_name: screenName, ...properties },
        timestamp: Date.now(),
      };

      // Run through plugin pipeline
      const processedEvent = runPluginPipeline(event, analyticsContext);

      if (!processedEvent) {
        debugLog(`Screen view cancelled by plugin: ${screenName}`);
        return;
      }

      debugLog(`Screen: ${screenName}`, processedEvent.properties);

      if (posthog) {
        try {
          posthog.screen(
            screenName,
            processedEvent.properties as unknown as PostHogEventProperties
          );
          runAfterTrack(processedEvent, analyticsContext);
        } catch (error) {
          if (__DEV__) console.error('PostHog screen error:', error);
        }
      }
    },
    [posthog, analyticsContext, runPluginPipeline, runAfterTrack, debugLog]
  );

  /**
   * Identify a user
   */
  const identify = useCallback(
    (userId: string, properties?: Record<string, unknown>) => {
      debugLog(`Identify: ${userId}`, properties);

      if (posthog) {
        try {
          posthog.identify(
            userId,
            properties as unknown as PostHogEventProperties
          );
        } catch (error) {
          if (__DEV__) console.error('PostHog identify error:', error);
        }
      }
    },
    [posthog, debugLog]
  );

  /**
   * Reset user identification
   */
  const reset = useCallback(() => {
    debugLog('Reset user');

    if (posthog) {
      try {
        posthog.reset();
      } catch (error) {
        if (__DEV__) console.error('PostHog reset error:', error);
      }
    }
  }, [posthog, debugLog]);

  /**
   * Start a timer for duration tracking
   */
  const startTimer = useCallback(
    (key: string) => {
      timersRef.current.set(key, {
        key,
        startTime: Date.now(),
      });
      debugLog(`Timer started: ${key}`);
    },
    [debugLog]
  );

  /**
   * End a timer and track event with duration
   */
  const endTimer = useCallback(
    (key: string, eventName: string, properties?: Record<string, unknown>) => {
      const timer = timersRef.current.get(key);

      if (!timer) {
        if (__DEV__) console.warn(`Timer not found: ${key}`);
        return;
      }

      const durationSeconds = Math.floor((Date.now() - timer.startTime) / 1000);
      timersRef.current.delete(key);

      track(eventName, {
        ...properties,
        duration_seconds: durationSeconds,
      });

      debugLog(`Timer ended: ${key} (${durationSeconds}s)`);
    },
    [track, debugLog]
  );

  /**
   * Get current duration of a running timer
   */
  const getTimerDuration = useCallback((key: string): number | null => {
    const timer = timersRef.current.get(key);

    if (!timer) {
      return null;
    }

    return Math.floor((Date.now() - timer.startTime) / 1000);
  }, []);

  /**
   * Cancel a timer without tracking
   */
  const cancelTimer = useCallback(
    (key: string) => {
      timersRef.current.delete(key);
      debugLog(`Timer cancelled: ${key}`);
    },
    [debugLog]
  );

  /**
   * Get current analytics context
   */
  const getContext = useCallback((): AnalyticsContextType => {
    return analyticsContext;
  }, [analyticsContext]);

  /**
   * Update analytics context
   */
  const updateContext = useCallback(
    (updates: Partial<AnalyticsContextType>) => {
      setAnalyticsContext(prev => ({
        ...prev,
        ...updates,
      }));
    },
    []
  );

  /**
   * Context value to provide
   */
  const contextValue: AnalyticsContextValue = useMemo(
    () => ({
      track,
      trackScreen,
      identify,
      reset,
      startTimer,
      endTimer,
      getTimerDuration,
      cancelTimer,
      getContext,
      updateContext,
      isReady: !!posthog,
    }),
    [
      track,
      trackScreen,
      identify,
      reset,
      startTimer,
      endTimer,
      getTimerDuration,
      cancelTimer,
      getContext,
      updateContext,
      posthog,
    ]
  );

  return (
    <AnalyticsContext.Provider value={contextValue}>
      {children}
    </AnalyticsContext.Provider>
  );
}

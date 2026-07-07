/**
 * Analytics Tracking Functions
 *
 * Low-level helpers that wrap a PostHog client with a consistent, null-safe API.
 * Prefer the `useAnalytics()` hook (or the module-level `analytics` singleton) in
 * app code; these exist for the hooks and for callers that already hold a client.
 */

import type { PostHogEventProperties } from '@posthog/core';
import type { usePostHog } from 'posthog-react-native';
import type { AnalyticsEventName } from './events';

// Properties may include undefined values (filtered out by PostHog at runtime).
type AnalyticsProperties = Record<string, unknown>;

type PostHogClient = ReturnType<typeof usePostHog> | null;

/**
 * Track an analytics event with optional properties
 */
export function trackEvent(
  posthog: PostHogClient,
  eventName: AnalyticsEventName | string,
  properties?: AnalyticsProperties
): void {
  if (!posthog) {
    if (__DEV__) console.warn('PostHog client not initialized');
    return;
  }

  try {
    posthog.capture(eventName, properties as unknown as PostHogEventProperties);
  } catch (error) {
    if (__DEV__) console.error('Error tracking event:', error);
  }
}

/**
 * Identify a user with properties
 */
export function identifyUser(
  posthog: PostHogClient,
  userId: string,
  properties?: AnalyticsProperties
): void {
  if (!posthog) {
    if (__DEV__) console.warn('PostHog client not initialized');
    return;
  }

  try {
    posthog.identify(userId, properties as unknown as PostHogEventProperties);
  } catch (error) {
    if (__DEV__) console.error('Error identifying user:', error);
  }
}

/**
 * Reset user identification (on logout)
 */
export function resetUser(posthog: PostHogClient): void {
  if (!posthog) {
    if (__DEV__) console.warn('PostHog client not initialized');
    return;
  }

  try {
    posthog.reset();
  } catch (error) {
    if (__DEV__) console.error('Error resetting user:', error);
  }
}

/**
 * Track a screen view
 */
export function trackScreen(
  posthog: PostHogClient,
  screenName: string,
  properties?: AnalyticsProperties
): void {
  if (!posthog) {
    if (__DEV__) console.warn('PostHog client not initialized');
    return;
  }

  try {
    posthog.screen(screenName, properties as unknown as PostHogEventProperties);
  } catch (error) {
    if (__DEV__) console.error('Error tracking screen:', error);
  }
}

/**
 * Start timing an event (returns a monotonic-ish start timestamp in ms).
 */
export function startTimer(): number {
  return Date.now();
}

/**
 * Calculate duration (seconds) from a timer start.
 */
export function calculateDuration(startTime: number): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

/**
 * Track event with automatic duration calculation
 */
export function trackEventWithDuration(
  posthog: PostHogClient,
  eventName: AnalyticsEventName | string,
  startTime: number,
  additionalProperties?: AnalyticsProperties
): void {
  const duration = calculateDuration(startTime);
  trackEvent(posthog, eventName, {
    ...additionalProperties,
    duration_seconds: duration,
  });
}

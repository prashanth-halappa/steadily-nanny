/**
 * Analytics Events
 *
 * Minimal, generic event taxonomy. Add your product's events here as `const`
 * entries — the `AnalyticsEventName` union widens automatically, and
 * `analytics.track()` also accepts arbitrary strings for ad-hoc events.
 */

export const ANALYTICS_EVENTS = {
  APP_OPENED: 'app_opened',
  SCREEN_VIEWED: 'screen_viewed',
  SIGN_IN_COMPLETED: 'sign_in_completed',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
} as const;

/** Type for all known event names. */
export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

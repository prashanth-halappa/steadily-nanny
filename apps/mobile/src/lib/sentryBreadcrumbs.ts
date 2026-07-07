/**
 * Sentry Breadcrumb Utilities
 *
 * Thin, generic helpers over `@sentry/react-native` for attaching user context
 * and action breadcrumbs so captured errors carry the trail that led up to
 * them. Import these throughout the app instead of calling Sentry directly.
 */
import * as Sentry from '@sentry/react-native';

/**
 * Feature areas for categorizing app actions. Keep these coarse and generic —
 * rename/extend to match your product's top-level surfaces.
 */
export type FeatureArea =
  | 'auth'
  | 'onboarding'
  | 'home'
  | 'settings'
  | 'notifications'
  | 'purchase'
  | 'unknown';

/**
 * Sets the current user context in Sentry.
 * Call this after successful authentication.
 *
 * SECURITY: only the opaque `id` is sent — never email or other PII (matches
 * `sendDefaultPii: false`). Do not add `email` here.
 *
 * @example
 * setUserContext({ id: 'user-123' });
 */
export function setUserContext(user: {
  id: string;
  email?: string | null;
}): void {
  Sentry.setUser({ id: user.id });
}

/**
 * Clears user context from Sentry.
 * Call this on logout.
 */
export function clearUserContext(): void {
  Sentry.setUser(null);
}

/**
 * Records a breadcrumb describing a user/app action, tagged by feature area.
 * These appear on the timeline of any error captured afterward.
 *
 * @example
 * addAppBreadcrumb('auth', 'Tapped sign in', { provider: 'apple' });
 */
export function addAppBreadcrumb(
  area: FeatureArea,
  message: string,
  data?: Record<string, unknown>
): void {
  Sentry.addBreadcrumb({
    category: area,
    message,
    level: 'info',
    data,
  });
}

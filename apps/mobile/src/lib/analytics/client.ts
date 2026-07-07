/**
 * PostHog client (module-level singleton).
 *
 * A single PostHog instance used by BOTH the module-level `analytics` singleton
 * (works outside React) AND the React `AnalyticsProvider`. Wire it into your app
 * shell so the two share one client and never double-count:
 *
 * ```tsx
 * import { PostHogProvider } from 'posthog-react-native';
 * import { posthogClient } from '@/src/lib/analytics';
 *
 * <PostHogProvider client={posthogClient ?? undefined}>
 *   <AnalyticsProvider>{children}</AnalyticsProvider>
 * </PostHogProvider>
 * ```
 *
 * `null` when no PostHog key is configured — analytics then no-ops.
 */

import PostHog from 'posthog-react-native';
import { env } from '@/src/config/env';

export const posthogClient: PostHog | null = env.posthogApiKey
  ? new PostHog(env.posthogApiKey, { host: env.posthogHost })
  : null;

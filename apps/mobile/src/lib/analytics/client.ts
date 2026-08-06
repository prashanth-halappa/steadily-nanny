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
 * <PostHogProvider client={posthogClient}>
 *   <AnalyticsProvider>{children}</AnalyticsProvider>
 * </PostHogProvider>
 * ```
 *
 * Always a client, never null: `usePostHog()` console.errors when the context
 * holds no client (posthog-react-native's `warnIfNoClient`). With no key
 * configured the client is built `disabled` instead, which short-circuits every
 * capture/identify/screen call inside the SDK — nothing queues, nothing sends.
 */

import PostHog from 'posthog-react-native';
import { env } from '@/src/config/env';

/** The SDK console.errors on an empty apiKey, so hand it a placeholder. */
const DISABLED_API_KEY = 'phc_disabled';

export const posthogClient: PostHog = new PostHog(
  env.posthogApiKey || DISABLED_API_KEY,
  { host: env.posthogHost, disabled: !env.posthogApiKey }
);

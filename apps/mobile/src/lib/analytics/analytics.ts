/**
 * `analytics` — module-level singleton for tracking OUTSIDE React.
 *
 * Use this from non-component code (services, stores, event handlers created
 * outside the tree). Inside components prefer the `useAnalytics()` hook, which
 * runs the plugin pipeline (enrichment/validation/logging). Both talk to the
 * same `posthogClient`, so events are never double-counted.
 *
 * All methods are null-safe: when PostHog is not configured they no-op.
 */

import type { PostHogEventProperties } from '@posthog/core';
import { posthogClient } from './client';

type Properties = Record<string, unknown>;

export const analytics = {
  /** Capture an event. */
  track(event: string, properties?: Properties): void {
    posthogClient?.capture(
      event,
      properties as unknown as PostHogEventProperties
    );
  },

  /** Capture a screen view. */
  screen(name: string, properties?: Properties): void {
    void posthogClient?.screen(
      name,
      properties as unknown as PostHogEventProperties
    );
  },

  /** Associate subsequent events with a user. */
  identify(distinctId: string, properties?: Properties): void {
    posthogClient?.identify(
      distinctId,
      properties as unknown as PostHogEventProperties
    );
  },

  /** Clear identity on logout. */
  reset(): void {
    posthogClient?.reset();
  },
};

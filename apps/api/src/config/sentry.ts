/**
 * Sentry configuration.
 *
 * Re-exports the Sentry SDK plus the shared feature-area helpers. The actual
 * `Sentry.init()` happens in `instrument.ts` (Bun dev preload) / via `withSentry` in `worker.ts`, which
 * imports the SAME `FEATURE_AREAS` map from `sentryFeatureAreas.ts`.
 *
 * @see ../instrument.ts
 * @module config/sentry
 */
import * as Sentry from '@sentry/cloudflare';

export {
  FEATURE_AREAS,
  type FeatureArea,
  getFeatureAreaFromPath,
} from './sentryFeatureAreas';

export default Sentry;

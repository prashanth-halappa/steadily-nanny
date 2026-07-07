/**
 * Sentry configuration.
 *
 * Re-exports the Sentry SDK plus the shared feature-area helpers. The actual
 * `Sentry.init()` happens in `instrument.ts` (loaded via `--preload`), which
 * imports the SAME `FEATURE_AREAS` map from `sentryFeatureAreas.ts`.
 *
 * @see ../instrument.ts
 * @module config/sentry
 */
import * as Sentry from '@sentry/bun';

export {
  FEATURE_AREAS,
  type FeatureArea,
  getFeatureAreaFromPath,
} from './sentryFeatureAreas';

export default Sentry;

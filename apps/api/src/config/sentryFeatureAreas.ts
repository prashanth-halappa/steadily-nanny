/**
 * Sentry feature-area tagging — SINGLE source of truth.
 *
 * The source repo duplicated this map verbatim in both `instrument.ts` and
 * `config/sentry.ts`. Here it lives in one module that both import, so the map
 * and the path-matching logic can never drift.
 *
 * SETUP: replace these example areas with your product's route groups. Each key
 * is a Sentry tag value; each string in the array is a path substring that maps
 * a request to that area.
 *
 * @module config/sentryFeatureAreas
 */
export const FEATURE_AREAS = {
  // SETUP: extend with your product's route groups.
  user: ['users', 'auth', 'profile'],
  jobs: ['jobs'],
} as const;

export type FeatureArea = keyof typeof FEATURE_AREAS | 'unknown';

/** Determine the feature area for a request path (for error/breadcrumb tags). */
export function getFeatureAreaFromPath(path?: string): FeatureArea {
  if (!path) {
    return 'unknown';
  }

  const normalizedPath = path.toLowerCase();

  for (const [feature, keywords] of Object.entries(FEATURE_AREAS)) {
    if (keywords.some(keyword => normalizedPath.includes(keyword))) {
      return feature as FeatureArea;
    }
  }

  return 'unknown';
}

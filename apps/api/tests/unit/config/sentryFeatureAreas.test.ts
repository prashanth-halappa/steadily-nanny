import { describe, expect, test } from 'bun:test';
import { getFeatureAreaFromPath } from '../../../src/config/sentryFeatureAreas';

describe('getFeatureAreaFromPath', () => {
  test('maps user paths to the user area', () => {
    expect(getFeatureAreaFromPath('/api/v1/users/me')).toBe('user');
    expect(getFeatureAreaFromPath('/api/v1/profile')).toBe('user');
  });

  test('maps job paths to the jobs area', () => {
    expect(getFeatureAreaFromPath('/api/jobs/example-maintenance')).toBe(
      'jobs'
    );
  });

  test('returns unknown for unmatched or empty paths', () => {
    expect(getFeatureAreaFromPath('/api/v1/unmapped-feature')).toBe('unknown');
    expect(getFeatureAreaFromPath(undefined)).toBe('unknown');
  });
});

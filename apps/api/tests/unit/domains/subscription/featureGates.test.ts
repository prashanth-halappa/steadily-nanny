import { describe, expect, test } from 'bun:test';
import {
  FEATURE_GATES,
  getFeatureLimit,
} from '../../../../src/domains/subscription/config/featureGates';

describe('featureGates', () => {
  test('example gates exist with free quotas and unlimited pro', () => {
    expect(FEATURE_GATES.widget_creation).toBeDefined();
    expect(FEATURE_GATES.llm_generation).toBeDefined();
    expect(getFeatureLimit('widget_creation', 'free')).toBe(3);
    expect(getFeatureLimit('widget_creation', 'pro')).toBeNull();
  });

  test('unknown feature is unlimited (fail-open)', () => {
    expect(getFeatureLimit('does_not_exist', 'free')).toBeNull();
  });
});

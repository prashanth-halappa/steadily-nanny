import { describe, expect, it } from 'bun:test';
import type { AppStatusResponse } from '../src/appConfig';
import type { SubscriptionTier } from '../src/constants';
import { ENTITLEMENT_TIER_MAP, SUBSCRIPTION_TIERS } from '../src/constants';
import { ERROR_CODES } from '../src/errorCodes';

describe('subscription constants', () => {
  it('exposes free and pro tiers', () => {
    expect(SUBSCRIPTION_TIERS.FREE).toBe('free');
    expect(SUBSCRIPTION_TIERS.PRO).toBe('pro');
    expect(Object.keys(SUBSCRIPTION_TIERS)).toEqual(['FREE', 'PRO']);
  });

  it('accepts free and pro as SubscriptionTier values', () => {
    const free: SubscriptionTier = 'free';
    const pro: SubscriptionTier = 'pro';
    expect(free).toBe('free');
    expect(pro).toBe('pro');
  });

  it('maps the placeholder entitlement id to the pro tier', () => {
    expect(ENTITLEMENT_TIER_MAP['yourapp-pro-entitlement']).toBe('pro');
    expect(Object.keys(ENTITLEMENT_TIER_MAP)).toEqual(['yourapp-pro-entitlement']);
  });
});

describe('entitlement error codes', () => {
  it('exposes the load-bearing gating codes with stable spelling', () => {
    expect(ERROR_CODES.PAYWALL_REQUIRED).toBe('PAYWALL_REQUIRED');
    expect(ERROR_CODES.USAGE_LIMIT_EXCEEDED).toBe('USAGE_LIMIT_EXCEEDED');
  });
});

describe('AppStatusResponse betaAllPro', () => {
  const base: AppStatusResponse = {
    status: 'ok',
    update: {
      required: false,
      available: false,
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      minimumVersion: '1.0.0',
      storeUrl: 'https://example.com',
    },
    announcements: [],
  };

  it('is optional (backward compatible)', () => {
    expect(base.betaAllPro).toBeUndefined();
  });

  it('can be toggled on and off', () => {
    expect({ ...base, betaAllPro: true }.betaAllPro).toBe(true);
    expect({ ...base, betaAllPro: false }.betaAllPro).toBe(false);
  });
});

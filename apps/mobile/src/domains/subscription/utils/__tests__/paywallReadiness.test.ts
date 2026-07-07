import { beforeEach, describe, expect, it } from 'bun:test';
import { useSubscriptionStore } from '@/src/store/subscriptionStore';
import { isPaywallReady } from '../paywallReadiness';

describe('isPaywallReady (App Store 2.1a guard)', () => {
  beforeEach(() => {
    useSubscriptionStore.getState().setConfigured(false);
  });

  it('returns false before the billing SDK is configured', () => {
    useSubscriptionStore.getState().setConfigured(false, 'no key');
    expect(isPaywallReady('test')).toBe(false);
  });

  it('returns true once the SDK is configured', () => {
    useSubscriptionStore.getState().setConfigured(true);
    expect(isPaywallReady('test')).toBe(true);
  });
});

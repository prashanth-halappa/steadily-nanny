import { beforeEach, describe, expect, it } from 'bun:test';
import { SUBSCRIPTION_TIERS } from '@yourapp/shared-types/constants';
import { useSubscriptionStore } from '../subscriptionStore';

// The template's placeholder Pro entitlement (see ENTITLEMENT_TIER_MAP).
const PRO_ENTITLEMENT = 'yourapp-pro-entitlement';

beforeEach(() => {
  useSubscriptionStore.getState().reset();
});

describe('useSubscriptionStore', () => {
  it('defaults to the free tier', () => {
    const state = useSubscriptionStore.getState();
    expect(state.tier).toBe(SUBSCRIPTION_TIERS.FREE);
    expect(state.isPro).toBe(false);
  });

  it('setTier updates tier and isPro together', () => {
    useSubscriptionStore.getState().setTier(SUBSCRIPTION_TIERS.PRO);
    expect(useSubscriptionStore.getState().tier).toBe(SUBSCRIPTION_TIERS.PRO);
    expect(useSubscriptionStore.getState().isPro).toBe(true);
  });

  it('setFromEntitlements grants Pro when the pro entitlement is active', () => {
    useSubscriptionStore.getState().setFromEntitlements([PRO_ENTITLEMENT]);
    expect(useSubscriptionStore.getState().tier).toBe(SUBSCRIPTION_TIERS.PRO);
    expect(useSubscriptionStore.getState().isPro).toBe(true);
  });

  it('setFromEntitlements falls back to free for unknown entitlements', () => {
    useSubscriptionStore.getState().setFromEntitlements(['some-other-id']);
    expect(useSubscriptionStore.getState().tier).toBe(SUBSCRIPTION_TIERS.FREE);
    expect(useSubscriptionStore.getState().isPro).toBe(false);
  });

  it('setFromEntitlements falls back to free for an empty list', () => {
    useSubscriptionStore.getState().setTier(SUBSCRIPTION_TIERS.PRO);
    useSubscriptionStore.getState().setFromEntitlements([]);
    expect(useSubscriptionStore.getState().tier).toBe(SUBSCRIPTION_TIERS.FREE);
    expect(useSubscriptionStore.getState().isPro).toBe(false);
  });

  it('applyBetaOverride(true) grants Pro', () => {
    useSubscriptionStore.getState().applyBetaOverride(true);
    expect(useSubscriptionStore.getState().tier).toBe(SUBSCRIPTION_TIERS.PRO);
    expect(useSubscriptionStore.getState().isPro).toBe(true);
  });

  it('applyBetaOverride(false) never downgrades a Pro user', () => {
    useSubscriptionStore.getState().setTier(SUBSCRIPTION_TIERS.PRO);
    useSubscriptionStore.getState().applyBetaOverride(false);
    expect(useSubscriptionStore.getState().isPro).toBe(true);
  });

  it('reset returns to the free tier', () => {
    useSubscriptionStore.getState().setTier(SUBSCRIPTION_TIERS.PRO);
    useSubscriptionStore.getState().reset();
    expect(useSubscriptionStore.getState().tier).toBe(SUBSCRIPTION_TIERS.FREE);
    expect(useSubscriptionStore.getState().isPro).toBe(false);
  });
});

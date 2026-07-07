import { beforeEach, describe, expect, it } from 'bun:test';
import { SUBSCRIPTION_TIERS } from '@yourapp/shared-types/constants';
import { useNotificationStore } from '../notificationStore';
import { useOnboardingStore } from '../onboarding';
import { resetUserScopedStores } from '../resetStores';
import { useSubscriptionStore } from '../subscriptionStore';

beforeEach(() => {
  useOnboardingStore.getState().reset();
  useSubscriptionStore.getState().reset();
  useNotificationStore.getState().reset();
});

describe('resetUserScopedStores', () => {
  it('resets onboarding, subscription, and notification stores', () => {
    useOnboardingStore.getState().completeStep('WELCOME');
    useSubscriptionStore.getState().setTier(SUBSCRIPTION_TIERS.PRO);
    useNotificationStore.getState().recordPrompt();

    resetUserScopedStores();

    expect(useOnboardingStore.getState().completedSteps).toEqual([]);
    expect(useSubscriptionStore.getState().tier).toBe(SUBSCRIPTION_TIERS.FREE);
    expect(useSubscriptionStore.getState().isPro).toBe(false);
    expect(useNotificationStore.getState().attempts).toBe(0);
    expect(useNotificationStore.getState().lastPromptAt).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from 'bun:test';
import { useNotificationStore } from '../notificationStore';
import { useOnboardingStore } from '../onboarding';
import { resetUserScopedStores } from '../resetStores';

beforeEach(() => {
  useOnboardingStore.getState().reset();
  useNotificationStore.getState().reset();
});

describe('resetUserScopedStores', () => {
  it('resets onboarding and notification stores', () => {
    useOnboardingStore.getState().completeStep('WELCOME');
    useNotificationStore.getState().recordPrompt();

    resetUserScopedStores();

    expect(useOnboardingStore.getState().completedSteps).toEqual([]);
    expect(useNotificationStore.getState().attempts).toBe(0);
    expect(useNotificationStore.getState().lastPromptAt).toBeNull();
  });
});

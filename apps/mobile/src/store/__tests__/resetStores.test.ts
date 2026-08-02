import { beforeEach, describe, expect, it } from 'bun:test';
import { SETUP_STEPS } from '@/src/domains/setup/types';
import { useActiveHouseholdStore } from '../activeHousehold';
import { useNotificationStore } from '../notificationStore';
import { resetUserScopedStores } from '../resetStores';
import { useSetupProgressStore } from '../setupProgress';

beforeEach(() => {
  useSetupProgressStore.getState().reset();
  useNotificationStore.getState().reset();
  useActiveHouseholdStore.getState().reset();
});

describe('resetUserScopedStores', () => {
  it('resets setup progress and notification stores', () => {
    useSetupProgressStore.getState().setRole('parent');
    useSetupProgressStore.getState().setCurrentStep(SETUP_STEPS.CHILDREN);
    useSetupProgressStore.getState().setHouseholdId('household-1');
    useNotificationStore.getState().recordPrompt();

    resetUserScopedStores();

    expect(useSetupProgressStore.getState().role).toBeNull();
    expect(useSetupProgressStore.getState().currentStep).toBe(SETUP_STEPS.ROLE);
    expect(useSetupProgressStore.getState().householdId).toBeNull();
    expect(useNotificationStore.getState().attempts).toBe(0);
    expect(useNotificationStore.getState().lastPromptAt).toBeNull();
  });

  it('resets the active-household preference (no stale household across accounts)', () => {
    useActiveHouseholdStore.getState().setPreferredHouseholdId('household-1');

    resetUserScopedStores();

    expect(useActiveHouseholdStore.getState().preferredHouseholdId).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from 'bun:test';
import { SETUP_ROLES, SETUP_STEPS } from '@/src/domains/setup/types';
import { useSetupProgressStore } from '../setupProgress';

beforeEach(() => {
  useSetupProgressStore.getState().reset();
});

describe('useSetupProgressStore', () => {
  it('starts on the ROLE step with no role chosen', () => {
    const state = useSetupProgressStore.getState();
    expect(state.role).toBeNull();
    expect(state.currentStep).toBe(SETUP_STEPS.ROLE);
    expect(state.isComplete).toBe(false);
    expect(state.householdId).toBeNull();
  });

  it('records the chosen role', () => {
    useSetupProgressStore.getState().setRole(SETUP_ROLES.NANNY);
    expect(useSetupProgressStore.getState().role).toBe(SETUP_ROLES.NANNY);
  });

  it('advances currentStep and caches the household id', () => {
    useSetupProgressStore.getState().setCurrentStep(SETUP_STEPS.CHILDREN);
    useSetupProgressStore.getState().setHouseholdId('household-1');

    const state = useSetupProgressStore.getState();
    expect(state.currentStep).toBe(SETUP_STEPS.CHILDREN);
    expect(state.householdId).toBe('household-1');
  });

  it('marks the flow complete', () => {
    useSetupProgressStore.getState().complete();
    expect(useSetupProgressStore.getState().isComplete).toBe(true);
  });

  it('reset() restores the initial state', () => {
    useSetupProgressStore.getState().setRole(SETUP_ROLES.PARENT);
    useSetupProgressStore.getState().complete();

    useSetupProgressStore.getState().reset();

    const state = useSetupProgressStore.getState();
    expect(state.role).toBeNull();
    expect(state.currentStep).toBe(SETUP_STEPS.ROLE);
    expect(state.isComplete).toBe(false);
  });
});

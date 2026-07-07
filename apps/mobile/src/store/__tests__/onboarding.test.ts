import { beforeEach, describe, expect, it } from 'bun:test';
import { ONBOARDING_STEPS } from '@yourapp/shared-types/onboarding';
import { useOnboardingStore } from '../onboarding';

beforeEach(() => {
  useOnboardingStore.getState().reset();
});

describe('useOnboardingStore', () => {
  it('starts at the first step with no completed steps', () => {
    const state = useOnboardingStore.getState();
    expect(state.completedSteps).toEqual([]);
    expect(state.currentStep).toBe(ONBOARDING_STEPS[0]);
    expect(state.isOnboardingComplete()).toBe(false);
  });

  it('completeStep records a step', () => {
    useOnboardingStore.getState().completeStep('WELCOME');
    expect(useOnboardingStore.getState().completedSteps).toEqual(['WELCOME']);
  });

  it('completeStep does not record duplicates', () => {
    useOnboardingStore.getState().completeStep('WELCOME');
    useOnboardingStore.getState().completeStep('WELCOME');
    expect(useOnboardingStore.getState().completedSteps).toEqual(['WELCOME']);
  });

  it('setCurrentStep moves the current step', () => {
    useOnboardingStore.getState().setCurrentStep('PROFILE');
    expect(useOnboardingStore.getState().currentStep).toBe('PROFILE');
  });

  it('isOnboardingComplete is true once every step is completed', () => {
    for (const step of ONBOARDING_STEPS) {
      useOnboardingStore.getState().completeStep(step);
    }
    expect(useOnboardingStore.getState().isOnboardingComplete()).toBe(true);
  });

  it('isOnboardingComplete is false while any step is missing', () => {
    for (const step of ONBOARDING_STEPS.slice(1)) {
      useOnboardingStore.getState().completeStep(step);
    }
    expect(useOnboardingStore.getState().isOnboardingComplete()).toBe(false);
  });

  it('reset clears progress back to the first step', () => {
    useOnboardingStore.getState().completeStep('WELCOME');
    useOnboardingStore.getState().setCurrentStep('PAYWALL');
    useOnboardingStore.getState().reset();

    const state = useOnboardingStore.getState();
    expect(state.completedSteps).toEqual([]);
    expect(state.currentStep).toBe(ONBOARDING_STEPS[0]);
  });
});

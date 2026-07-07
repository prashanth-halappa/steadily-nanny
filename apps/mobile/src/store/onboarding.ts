/**
 * onboarding.ts
 *
 * Persisted onboarding progress. Progress is tracked as a set of completed
 * steps plus the current step, so steps can be added or reordered without a
 * persist migration. Server state (flows, profile fields) is intentionally NOT
 * stored here — TanStack Query owns server state.
 */

import {
  ONBOARDING_STEPS,
  type OnboardingStep,
} from '@yourapp/shared-types/onboarding';
import { createPersistedStore } from './createPersistedStore';

/** The step a fresh user starts on (the first configured step). */
const INITIAL_STEP: OnboardingStep = ONBOARDING_STEPS[0];

export interface OnboardingState {
  /** Steps the user has completed (deduplicated, order of completion). */
  completedSteps: OnboardingStep[];
  /** The step the user is currently on. */
  currentStep: OnboardingStep;

  /** Mark a step complete (no-op if already recorded). */
  completeStep: (step: OnboardingStep) => void;
  /** Move the user to a given step. */
  setCurrentStep: (step: OnboardingStep) => void;
  /** Reset onboarding progress back to the first step. */
  reset: () => void;

  /** True once every ONBOARDING_STEPS entry has been completed. */
  isOnboardingComplete: () => boolean;
}

export const useOnboardingStore = createPersistedStore<OnboardingState>(
  (set, get) => ({
    completedSteps: [],
    currentStep: INITIAL_STEP,

    completeStep: step =>
      set(state =>
        state.completedSteps.includes(step)
          ? state
          : { completedSteps: [...state.completedSteps, step] }
      ),

    setCurrentStep: step => set({ currentStep: step }),

    reset: () => set({ completedSteps: [], currentStep: INITIAL_STEP }),

    isOnboardingComplete: () => {
      const { completedSteps } = get();
      return ONBOARDING_STEPS.every(step => completedSteps.includes(step));
    },
  }),
  {
    name: 'onboarding-storage',
    version: 1,
    // Only persist client progress; server-owned config is not stored here.
    partialize: state => ({
      completedSteps: state.completedSteps,
      currentStep: state.currentStep,
    }),
  }
);

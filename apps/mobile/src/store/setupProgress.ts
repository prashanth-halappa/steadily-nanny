/**
 * setupProgress.ts
 *
 * Persisted progress through the Wave 1 role-fork setup flow (replaces the
 * old `onboarding.ts` WELCOME/PROFILE/NOTIFICATIONS placeholder machine — see
 * `src/domains/setup/types` for why that's client-only here rather than
 * sourced from shared-types). Tracks which role the user picked and which
 * step they're on, so a cold start can resume mid-flow. Server state
 * (household, children, invites) is intentionally NOT stored here — TanStack
 * Query owns that.
 */

import {
  SETUP_STEPS,
  type SetupRole,
  type SetupStep,
} from '@/src/domains/setup/types';
import { createPersistedStore } from './createPersistedStore';

export interface SetupProgressState {
  /** Chosen role, or null before the role-fork screen is completed. */
  role: SetupRole | null;
  /** The step the user is currently on. */
  currentStep: SetupStep;
  /** True once the user has finished their role's full step sequence. */
  isComplete: boolean;
  /** Household id created/redeemed during setup, cached for convenience. */
  householdId: string | null;

  setRole: (role: SetupRole) => void;
  setCurrentStep: (step: SetupStep) => void;
  setHouseholdId: (householdId: string) => void;
  /** Mark the whole flow finished (drops the user onto the Today screen). */
  complete: () => void;
  /** Reset progress back to the start (e.g. on sign-out). */
  reset: () => void;
}

const INITIAL_STEP: SetupStep = SETUP_STEPS.ROLE;

export const useSetupProgressStore = createPersistedStore<SetupProgressState>(
  set => ({
    role: null,
    currentStep: INITIAL_STEP,
    isComplete: false,
    householdId: null,

    setRole: role => set({ role }),
    setCurrentStep: currentStep => set({ currentStep }),
    setHouseholdId: householdId => set({ householdId }),
    complete: () => set({ isComplete: true }),
    reset: () =>
      set({
        role: null,
        currentStep: INITIAL_STEP,
        isComplete: false,
        householdId: null,
      }),
  }),
  {
    name: 'setup-progress-storage',
    version: 1,
    partialize: state => ({
      role: state.role,
      currentStep: state.currentStep,
      isComplete: state.isComplete,
      householdId: state.householdId,
    }),
  }
);

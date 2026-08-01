/**
 * setupProgress.ts
 *
 * IN-FLIGHT UI STATE ONLY for the Wave 1 role-fork setup wizard — which role
 * the user picked and which step they're on WITHIN A SINGLE ACTIVE SESSION,
 * so mid-wizard navigation reads cleanly. This is NOT the source of truth for
 * "is this user set up" — that predicate is server-derived, see
 * `src/hooks/queries/useIsOnboarded.ts`'s header comment for why local MMKV
 * was the wrong choice (it doesn't survive sign-out/sign-in, reinstalls, or a
 * second device, and disagreeing with the server is exactly what stranded a
 * returning parent in the wizard forever — see the fix in `store/auth.ts`).
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
  /** Household id created/redeemed during setup, cached for convenience. */
  householdId: string | null;

  setRole: (role: SetupRole) => void;
  setCurrentStep: (step: SetupStep) => void;
  setHouseholdId: (householdId: string) => void;
  /** Reset progress back to the start (e.g. on a genuine account switch). */
  reset: () => void;
}

const INITIAL_STEP: SetupStep = SETUP_STEPS.ROLE;

export const useSetupProgressStore = createPersistedStore<SetupProgressState>(
  set => ({
    role: null,
    currentStep: INITIAL_STEP,
    householdId: null,

    setRole: role => set({ role }),
    setCurrentStep: currentStep => set({ currentStep }),
    setHouseholdId: householdId => set({ householdId }),
    reset: () =>
      set({
        role: null,
        currentStep: INITIAL_STEP,
        householdId: null,
      }),
  }),
  {
    name: 'setup-progress-storage',
    version: 1,
    partialize: state => ({
      role: state.role,
      currentStep: state.currentStep,
      householdId: state.householdId,
    }),
  }
);

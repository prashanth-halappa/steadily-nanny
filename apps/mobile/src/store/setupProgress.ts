/**
 * setupProgress.ts
 *
 * IN-FLIGHT UI STATE ONLY for the role x path setup wizard — which role and
 * which path the user picked and which step they're on WITHIN A SINGLE ACTIVE
 * SESSION, so mid-wizard navigation reads cleanly. This is NOT the source of
 * truth for "is this user set up" — that predicate is server-derived, see
 * `src/hooks/queries/useIsOnboarded.ts`'s header comment for why local MMKV
 * was the wrong choice (it doesn't survive sign-out/sign-in, reinstalls, or a
 * second device, and disagreeing with the server is exactly what stranded a
 * returning parent in the wizard forever — see the fix in `store/auth.ts`).
 *
 * `role` IS STILL SET FIRST, AND SEPARATELY FROM `path`. That ordering is
 * load-bearing: `app/onboarding/_layout.tsx` reads `role !== null` as
 * `wizardEngaged` to suppress its bounce-an-onboarded-user-out guard, and its
 * header records the on-device repro that guard exists for. Adding `path` to
 * that predicate would re-strand the user it was written for.
 */

import {
  SETUP_PATHS,
  SETUP_ROLES,
  SETUP_STEPS,
  type SetupPath,
  type SetupRole,
  type SetupStep,
} from '@/src/domains/setup/types';
import { createPersistedStore } from './createPersistedStore';

export interface SetupProgressState {
  /** Chosen role, or null before the role-fork screen is completed. */
  role: SetupRole | null;
  /** Chosen path, or null before the start-fork screen is completed (D-33). */
  path: SetupPath | null;
  /** The step the user is currently on. */
  currentStep: SetupStep;
  /** Household id created/redeemed during setup, cached for convenience. */
  householdId: string | null;

  setRole: (role: SetupRole) => void;
  setPath: (path: SetupPath) => void;
  setCurrentStep: (step: SetupStep) => void;
  setHouseholdId: (householdId: string) => void;
  /** Reset progress back to the start (e.g. on a genuine account switch). */
  reset: () => void;
}

const INITIAL_STEP: SetupStep = SETUP_STEPS.ROLE;

/** The durable slice — the actions are recreated by the initializer. */
type PersistedSetupProgress = Pick<
  SetupProgressState,
  'role' | 'path' | 'currentStep' | 'householdId'
>;

const INITIAL_PERSISTED: PersistedSetupProgress = {
  role: null,
  path: null,
  currentStep: INITIAL_STEP,
  householdId: null,
};

/**
 * v1 -> v2: `path` did not exist, so every install on disk has a mid-wizard
 * state whose sequence was implied by role alone. Rather than dropping those
 * users back to the role fork, infer the path v1 would have walked them down:
 * parent meant create (ROLE -> CHILDREN -> INVITE), nanny and helper meant
 * join (ROLE -> CODE -> ...). Both inferred sequences still contain the step
 * these users are persisted on, so `getUnfinishedSetupResumeRoute` resumes
 * them exactly where they were.
 *
 * Exported for the test — a migration nobody can run in isolation is a
 * migration nobody has checked.
 */
export function migrateSetupProgress(
  persisted: unknown,
  version: number
): PersistedSetupProgress {
  if (version > 2 || !persisted || typeof persisted !== 'object') {
    return { ...INITIAL_PERSISTED };
  }

  const prior = persisted as Partial<PersistedSetupProgress>;
  const role = prior.role ?? null;
  const inferredPath =
    role === null
      ? null
      : role === SETUP_ROLES.PARENT
        ? SETUP_PATHS.CREATE
        : SETUP_PATHS.JOIN;

  return {
    role,
    path: prior.path ?? inferredPath,
    currentStep: prior.currentStep ?? INITIAL_STEP,
    householdId: prior.householdId ?? null,
  };
}

export const useSetupProgressStore = createPersistedStore<SetupProgressState>(
  set => ({
    ...INITIAL_PERSISTED,

    setRole: role => set({ role }),
    setPath: path => set({ path }),
    setCurrentStep: currentStep => set({ currentStep }),
    setHouseholdId: householdId => set({ householdId }),
    reset: () => set({ ...INITIAL_PERSISTED }),
  }),
  {
    name: 'setup-progress-storage',
    version: 2,
    migrate: migrateSetupProgress,
    partialize: state => ({
      role: state.role,
      path: state.path,
      currentStep: state.currentStep,
      householdId: state.householdId,
    }),
  }
);

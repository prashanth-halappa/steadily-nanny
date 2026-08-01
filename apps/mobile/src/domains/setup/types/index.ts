/**
 * @module domains/setup/types
 *
 * Client-only role-fork setup flow types. Deliberately NOT sourced from
 * `@steadily-nanny/shared-types/onboarding` — that package's `ONBOARDING_STEPS`
 * is the old WELCOME/PROFILE/NOTIFICATIONS placeholder machine, explicitly
 * commented there as "WAVE 1 WILL REPLACE THIS LIST". This flow supersedes it
 * on the mobile side; the shared package is out of scope for this app
 * (read-only wire contract owned by another workstream).
 */

/** Which side of the household a fresh user is. */
export const SETUP_ROLES = {
  PARENT: 'parent',
  NANNY: 'nanny',
} as const;
export type SetupRole = (typeof SETUP_ROLES)[keyof typeof SETUP_ROLES];

/**
 * Ordered step id per role. `ROLE` is shared; the two paths diverge after
 * that (parent: children -> invite; nanny: code -> availability).
 */
export const SETUP_STEPS = {
  ROLE: 'ROLE',
  CHILDREN: 'CHILDREN',
  INVITE: 'INVITE',
  CODE: 'CODE',
  AVAILABILITY: 'AVAILABILITY',
} as const;
export type SetupStep = (typeof SETUP_STEPS)[keyof typeof SETUP_STEPS];

/** Route for each step. Adjust if the route filenames change. */
export const SETUP_STEP_ROUTES: Record<SetupStep, string> = {
  ROLE: '/onboarding/role',
  CHILDREN: '/onboarding/children',
  INVITE: '/onboarding/invite',
  CODE: '/onboarding/code',
  AVAILABILITY: '/onboarding/availability',
};

/** The ordered step sequence for a given role (role step included). */
export function stepsForRole(role: SetupRole | null): SetupStep[] {
  if (role === SETUP_ROLES.PARENT) {
    return [SETUP_STEPS.ROLE, SETUP_STEPS.CHILDREN, SETUP_STEPS.INVITE];
  }
  if (role === SETUP_ROLES.NANNY) {
    return [SETUP_STEPS.ROLE, SETUP_STEPS.CODE, SETUP_STEPS.AVAILABILITY];
  }
  return [SETUP_STEPS.ROLE];
}

/** The route to navigate to for a given step. */
export function getSetupStepRoute(step: SetupStep): string {
  return SETUP_STEP_ROUTES[step];
}

/** The step after `current` for `role`, or null if `current` is the last step. */
export function getNextSetupStep(
  role: SetupRole | null,
  current: SetupStep
): SetupStep | null {
  const steps = stepsForRole(role);
  const index = steps.indexOf(current);
  if (index < 0 || index >= steps.length - 1) return null;
  return steps[index + 1] ?? null;
}

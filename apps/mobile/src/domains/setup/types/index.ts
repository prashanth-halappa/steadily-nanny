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
  HELPER: 'helper',
} as const;
export type SetupRole = (typeof SETUP_ROLES)[keyof typeof SETUP_ROLES];

/** Roles that can edit household data (children, invites, schedule). */
export function isParentEditorRole(role: SetupRole | null): boolean {
  return role === SETUP_ROLES.PARENT;
}

/** Roles that see the parent-facing schedule and Today views (read-only for helper). */
export function canViewParentSchedule(role: SetupRole | null): boolean {
  return role === SETUP_ROLES.PARENT || role === SETUP_ROLES.HELPER;
}

/**
 * Ordered step id per role. `ROLE` is shared; the two paths diverge after
 * that (parent: children -> invite; nanny: code -> availability), and every
 * role rejoins for the two permission-priming steps at the end.
 */
export const SETUP_STEPS = {
  ROLE: 'ROLE',
  CHILDREN: 'CHILDREN',
  INVITE: 'INVITE',
  CODE: 'CODE',
  AVAILABILITY: 'AVAILABILITY',
  NOTIFICATIONS_PERMISSION: 'NOTIFICATIONS_PERMISSION',
  CALENDAR_PERMISSION: 'CALENDAR_PERMISSION',
} as const;
export type SetupStep = (typeof SETUP_STEPS)[keyof typeof SETUP_STEPS];

/** Route for each step. Adjust if the route filenames change. */
export const SETUP_STEP_ROUTES: Record<SetupStep, string> = {
  ROLE: '/onboarding/role',
  CHILDREN: '/onboarding/children',
  INVITE: '/onboarding/invite',
  CODE: '/onboarding/code',
  AVAILABILITY: '/onboarding/availability',
  NOTIFICATIONS_PERMISSION: '/onboarding/notifications',
  CALENDAR_PERMISSION: '/onboarding/calendar',
};

/**
 * The ordered step sequence for a given role (role step included).
 *
 * Helper never sees calendar sync (nothing to schedule around as a
 * read-only viewer) or availability (that's a nanny-only commitment), but
 * still gets asked about notifications like everyone else.
 */
export function stepsForRole(role: SetupRole | null): SetupStep[] {
  if (role === SETUP_ROLES.PARENT) {
    return [
      SETUP_STEPS.ROLE,
      SETUP_STEPS.CHILDREN,
      SETUP_STEPS.INVITE,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
      SETUP_STEPS.CALENDAR_PERMISSION,
    ];
  }
  if (role === SETUP_ROLES.NANNY) {
    return [
      SETUP_STEPS.ROLE,
      SETUP_STEPS.CODE,
      SETUP_STEPS.AVAILABILITY,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
      SETUP_STEPS.CALENDAR_PERMISSION,
    ];
  }
  if (role === SETUP_ROLES.HELPER) {
    return [
      SETUP_STEPS.ROLE,
      SETUP_STEPS.CODE,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
    ];
  }
  return [SETUP_STEPS.ROLE];
}

/** The route to navigate to for a given step. */
export function getSetupStepRoute(step: SetupStep): string {
  return SETUP_STEP_ROUTES[step];
}

/**
 * When the server already considers the user onboarded but persisted wizard
 * state says they have not reached the final step, return the route to resume.
 * Returns null when setup is finished, never started, or the step is stale —
 * callers route home. Finish paths call `useSetupProgressStore.reset()` so a
 * completed wizard cannot loop back into itself on the next cold start.
 */
export function getUnfinishedSetupResumeRoute(
  role: SetupRole | null,
  currentStep: SetupStep
): string | null {
  if (role === null) return null;
  const steps = stepsForRole(role);
  const lastStep = steps[steps.length - 1];
  if (currentStep === lastStep) return null;
  if (!steps.includes(currentStep)) return null;
  return getSetupStepRoute(currentStep);
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

/**
 * Wizard progress-bar fraction (0..1) for `step` within `role`'s sequence.
 * The last step of every role's sequence always reports 1 (full bar) —
 * screens no longer hardcode an approximate literal per step.
 */
export function getStepProgress(
  role: SetupRole | null,
  step: SetupStep
): number {
  const steps = stepsForRole(role);
  const index = steps.indexOf(step);
  if (index < 0) return 1;
  return (index + 1) / steps.length;
}

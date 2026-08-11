/**
 * @module domains/setup/types
 *
 * Client-only setup-flow step machine. Deliberately NOT sourced from
 * `@steadily-nanny/shared-types/onboarding` — that package's `ONBOARDING_STEPS`
 * is the old WELCOME/PROFILE/NOTIFICATIONS placeholder machine, explicitly
 * commented there as "WAVE 1 WILL REPLACE THIS LIST". This flow supersedes it
 * on the mobile side; the shared package is out of scope for this app
 * (read-only wire contract owned by another workstream).
 *
 * ROLE x PATH, not role alone (D-33, `screens-onboarding-terms-proposal.md`
 * §3.1–§3.3). The old machine welded creation to `parent` and joining to
 * `nanny`: there was no sequence in which a nanny created anything, and none
 * in which a parent typed a code as a first-class act. The role fork's third
 * "I have an invite code" card was a PATH masquerading as a role, and it
 * persisted `SETUP_ROLES.NANNY` for a co-parent purely as wiring convenience.
 * Both questions are now asked once each, on their own screen, and the answers
 * multiply out to four honest sequences.
 */

/** Which side of the household a fresh user is. */
export const SETUP_ROLES = {
  PARENT: 'parent',
  NANNY: 'nanny',
  HELPER: 'helper',
} as const;
export type SetupRole = (typeof SETUP_ROLES)[keyof typeof SETUP_ROLES];

/**
 * How they are starting — the second half of D-33. Orthogonal to role: BOTH
 * cards exist for BOTH roles, which is the whole point.
 */
export const SETUP_PATHS = {
  CREATE: 'create',
  JOIN: 'join',
} as const;
export type SetupPath = (typeof SETUP_PATHS)[keyof typeof SETUP_PATHS];

/** Roles that can edit household data (children, invites, schedule). */
export function isParentEditorRole(role: SetupRole | null): boolean {
  return role === SETUP_ROLES.PARENT;
}

/** Roles that see the parent-facing schedule and Today views (read-only for helper). */
export function canViewParentSchedule(role: SetupRole | null): boolean {
  return role === SETUP_ROLES.PARENT || role === SETUP_ROLES.HELPER;
}

/**
 * Ordered step ids. `ROLE` and `START` are shared by every sequence; the four
 * sequences diverge after that and rejoin for the permission-priming steps.
 */
export const SETUP_STEPS = {
  ROLE: 'ROLE',
  START: 'START',
  HOUSEHOLD: 'HOUSEHOLD',
  CHILDREN: 'CHILDREN',
  INVITE: 'INVITE',
  TERMS: 'TERMS',
  CODE: 'CODE',
  AVAILABILITY: 'AVAILABILITY',
  NOTIFICATIONS_PERMISSION: 'NOTIFICATIONS_PERMISSION',
  CALENDAR_PERMISSION: 'CALENDAR_PERMISSION',
} as const;
export type SetupStep = (typeof SETUP_STEPS)[keyof typeof SETUP_STEPS];

/** Route for each step. Adjust if the route filenames change. */
export const SETUP_STEP_ROUTES: Record<SetupStep, string> = {
  ROLE: '/onboarding/role',
  START: '/onboarding/start',
  HOUSEHOLD: '/onboarding/household',
  CHILDREN: '/onboarding/children',
  INVITE: '/onboarding/invite',
  TERMS: '/onboarding/terms',
  CODE: '/onboarding/code',
  AVAILABILITY: '/onboarding/availability',
  NOTIFICATIONS_PERMISSION: '/onboarding/notifications',
  CALENDAR_PERMISSION: '/onboarding/calendar',
};

const PERMISSION_STEPS = [
  SETUP_STEPS.NOTIFICATIONS_PERMISSION,
  SETUP_STEPS.CALENDAR_PERMISSION,
] as const;

/**
 * The ordered step sequence for a role x path pair (§3.3's table).
 *
 * Two partial states are real and must both be answerable, because they are
 * what the wizard looks like BETWEEN the two forks:
 *   - no role yet -> just the role fork.
 *   - role but no path -> the role fork and the start fork, nothing beyond.
 * Returning a full sequence for either would let `getUnfinishedSetupResumeRoute`
 * resume someone into a step they have not earned an answer for yet.
 *
 * Helper is path-insensitive on purpose: nobody ever picks "I'm a helper" —
 * that role is only ever resolved from a redeemed membership, which means the
 * join path is the only way to reach it. Returning the same sequence for
 * `create` keeps the function total rather than adding an unreachable branch.
 */
export function stepsFor(
  role: SetupRole | null,
  path: SetupPath | null
): SetupStep[] {
  if (role === null) return [SETUP_STEPS.ROLE];
  // `?? null` rather than `=== null`: an install persisted before `path`
  // existed rehydrates it as `undefined` if the migration is ever bypassed,
  // and "not null but not a path either" would fall through to the JOIN
  // branch below and silently strand a creating parent.
  if ((path ?? null) === null) return [SETUP_STEPS.ROLE, SETUP_STEPS.START];

  const prefix = [SETUP_STEPS.ROLE, SETUP_STEPS.START];

  if (role === SETUP_ROLES.HELPER) {
    return [...prefix, SETUP_STEPS.CODE, SETUP_STEPS.NOTIFICATIONS_PERMISSION];
  }

  if (role === SETUP_ROLES.PARENT) {
    return path === SETUP_PATHS.CREATE
      ? [
          ...prefix,
          SETUP_STEPS.HOUSEHOLD,
          SETUP_STEPS.CHILDREN,
          SETUP_STEPS.INVITE,
          ...PERMISSION_STEPS,
        ]
      : // A joining parent NEVER passes through CHILDREN. That screen
        // auto-creates a household on first entry, so putting it in the join
        // sequence would hand a co-parent a second, empty family alongside
        // the one they just redeemed their way into.
        [...prefix, SETUP_STEPS.CODE, ...PERMISSION_STEPS];
  }

  return path === SETUP_PATHS.CREATE
    ? [
        ...prefix,
        SETUP_STEPS.TERMS,
        SETUP_STEPS.AVAILABILITY,
        ...PERMISSION_STEPS,
      ]
    : [
        ...prefix,
        SETUP_STEPS.CODE,
        SETUP_STEPS.AVAILABILITY,
        ...PERMISSION_STEPS,
      ];
}

/**
 * The first step that does real work for a role x path — everything after the
 * two forks. THE single source for that mapping.
 *
 * It was previously hardcoded in three places (RoleScreen's parent/nanny
 * ternary, `app/index.tsx`'s resume branch, and CodeEntryScreen's
 * `?? NOTIFICATIONS_PERMISSION` post-redeem fallback), and the three had
 * already drifted: CodeEntryScreen's fallback existed ONLY because
 * `stepsForRole(PARENT)` did not contain CODE, so `getNextSetupStep` returned
 * null for a co-parent who had just redeemed an invite. With CODE in the join
 * sequence that hole closes by construction.
 */
export function entryStepFor(
  role: SetupRole | null,
  path: SetupPath | null
): SetupStep {
  const steps = stepsFor(role, path);
  // index 2 is the step after ROLE and START; the `??` covers the two partial
  // sequences, where the last named step IS the answer.
  return steps[2] ?? steps[steps.length - 1] ?? SETUP_STEPS.ROLE;
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
  path: SetupPath | null,
  currentStep: SetupStep
): string | null {
  if (role === null) return null;
  const steps = stepsFor(role, path);
  // A path-less sequence is PARTIAL, not finished: its last element is the
  // start fork, which is the one question still outstanding. Reading it as
  // terminal would route a user who picked a role and then backgrounded the
  // app straight home, past the fork that decides everything after it.
  const lastStep = (path ?? null) === null ? null : steps[steps.length - 1];
  if (currentStep === lastStep) return null;
  if (!steps.includes(currentStep)) return null;
  return getSetupStepRoute(currentStep);
}

/** The step after `current` for this role x path, or null if `current` is last. */
export function getNextSetupStep(
  role: SetupRole | null,
  path: SetupPath | null,
  current: SetupStep
): SetupStep | null {
  const steps = stepsFor(role, path);
  const index = steps.indexOf(current);
  if (index < 0 || index >= steps.length - 1) return null;
  return steps[index + 1] ?? null;
}

/**
 * Wizard progress-bar fraction (0..1) for `step` within this role x path
 * sequence. The last step of every sequence always reports 1 (full bar) —
 * screens never hardcode an approximate literal per step.
 */
export function getStepProgress(
  role: SetupRole | null,
  path: SetupPath | null,
  step: SetupStep
): number {
  const steps = stepsFor(role, path);
  const index = steps.indexOf(step);
  if (index < 0) return 1;
  return (index + 1) / steps.length;
}

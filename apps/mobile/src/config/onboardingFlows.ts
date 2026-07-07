/**
 * Onboarding flow engine.
 *
 * Steps come from the shared `ONBOARDING_STEPS` machine (WELCOME → PROFILE →
 * NOTIFICATIONS → PAYWALL). Progress is a set of completed steps, so steps can be
 * added/reordered without a client migration. Map each step to its route below.
 */

import {
  type FlowStep,
  ONBOARDING_STEPS,
  type OnboardingFlow,
  type OnboardingStep,
} from '@yourapp/shared-types/onboarding';

/** Route for each step. SETUP: adjust if you rename the onboarding route files. */
export const ONBOARDING_ROUTES: Record<OnboardingStep, string> = {
  WELCOME: '/onboarding/welcome',
  PROFILE: '/onboarding/profile',
  NOTIFICATIONS: '/onboarding/notifications',
  PAYWALL: '/onboarding/paywall',
};

const STEP_LABELS: Record<OnboardingStep, string> = {
  WELCOME: 'Welcome',
  PROFILE: 'Profile',
  NOTIFICATIONS: 'Notifications',
  PAYWALL: 'Upgrade',
};

/** The default (only) flow definition. */
export const defaultOnboardingFlow: OnboardingFlow = {
  steps: ONBOARDING_STEPS.map<FlowStep>(id => ({
    id,
    screen: ONBOARDING_ROUTES[id],
    label: STEP_LABELS[id],
  })),
};

/** The route to navigate to for a given step. */
export function getStepRoute(step: OnboardingStep): string {
  return ONBOARDING_ROUTES[step];
}

/** The next step after `current`, or null if `current` is the last step. */
export function getNextStep(current: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(current);
  if (index < 0 || index >= ONBOARDING_STEPS.length - 1) return null;
  return ONBOARDING_STEPS[index + 1] ?? null;
}

/** True once every configured step is present in `completed`. */
export function isFlowComplete(completed: OnboardingStep[]): boolean {
  return ONBOARDING_STEPS.every(step => completed.includes(step));
}

/** Fractional + absolute progress through the flow. */
export function getFlowProgress(completed: OnboardingStep[]): {
  completed: number;
  total: number;
  ratio: number;
} {
  const total = ONBOARDING_STEPS.length;
  const done = ONBOARDING_STEPS.filter(step => completed.includes(step)).length;
  return { completed: done, total, ratio: total ? done / total : 0 };
}

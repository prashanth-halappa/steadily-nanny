import { ONBOARDING_STEPS } from '@yourapp/shared-types/onboarding';
import { useOnboardingStore } from '@/src/store/onboarding';

/**
 * Default `isOnboarded` predicate for the private-layout auth gate: onboarding
 * is complete once every configured step has been recorded. Swap for a
 * server-truth check (e.g. profile completeness) if your app needs one.
 */
export function useIsOnboarded(): boolean {
  const completedSteps = useOnboardingStore(s => s.completedSteps);
  return ONBOARDING_STEPS.every(step => completedSteps.includes(step));
}

import type { OnboardingStep } from '@yourapp/shared-types/onboarding';
import { type Href, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { getNextStep, getStepRoute } from '@/src/config/onboardingFlows';
import { analytics } from '@/src/lib/analytics';
import { useOnboardingStore } from '@/src/store/onboarding';

/**
 * Drives onboarding navigation: mark the current step complete, record analytics,
 * and advance to the next step (or into the app when the flow is done).
 */
export function useOnboardingNavigation() {
  const router = useRouter();
  const completeStep = useOnboardingStore(s => s.completeStep);
  const setCurrentStep = useOnboardingStore(s => s.setCurrentStep);

  const goToStep = useCallback(
    (step: OnboardingStep) => {
      setCurrentStep(step);
      router.push(getStepRoute(step) as Href);
    },
    [router, setCurrentStep]
  );

  const completeAndAdvance = useCallback(
    (step: OnboardingStep) => {
      completeStep(step);
      analytics.track('onboarding_step_completed', { step });
      const next = getNextStep(step);
      if (next) {
        setCurrentStep(next);
        router.push(getStepRoute(next) as Href);
      } else {
        router.replace('/' as Href);
      }
    },
    [completeStep, router, setCurrentStep]
  );

  return { goToStep, completeAndAdvance };
}

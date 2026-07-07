import { describe, expect, it } from 'bun:test';
import {
  getFlowProgress,
  getNextStep,
  getStepRoute,
  isFlowComplete,
} from '../onboardingFlows';

describe('onboarding flow engine', () => {
  it('returns the next step in order', () => {
    expect(getNextStep('WELCOME')).toBe('PROFILE');
    expect(getNextStep('PROFILE')).toBe('NOTIFICATIONS');
    expect(getNextStep('NOTIFICATIONS')).toBe('PAYWALL');
  });

  it('returns null after the last step', () => {
    expect(getNextStep('PAYWALL')).toBeNull();
  });

  it('maps each step to a route', () => {
    expect(getStepRoute('WELCOME')).toBe('/onboarding/welcome');
    expect(getStepRoute('PAYWALL')).toBe('/onboarding/paywall');
  });

  it('reports completion only when every step is present', () => {
    expect(isFlowComplete(['WELCOME', 'PROFILE'])).toBe(false);
    expect(
      isFlowComplete(['WELCOME', 'PROFILE', 'NOTIFICATIONS', 'PAYWALL'])
    ).toBe(true);
  });

  it('computes fractional progress', () => {
    expect(getFlowProgress([])).toEqual({ completed: 0, total: 4, ratio: 0 });
    const half = getFlowProgress(['WELCOME', 'PROFILE']);
    expect(half.completed).toBe(2);
    expect(half.ratio).toBeCloseTo(0.5);
  });
});

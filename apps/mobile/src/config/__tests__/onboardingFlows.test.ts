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
  });

  it('returns null after the last step', () => {
    expect(getNextStep('NOTIFICATIONS')).toBeNull();
  });

  it('maps each step to a route', () => {
    expect(getStepRoute('WELCOME')).toBe('/onboarding/welcome');
    expect(getStepRoute('NOTIFICATIONS')).toBe('/onboarding/notifications');
  });

  it('reports completion only when every step is present', () => {
    expect(isFlowComplete(['WELCOME', 'PROFILE'])).toBe(false);
    expect(isFlowComplete(['WELCOME', 'PROFILE', 'NOTIFICATIONS'])).toBe(true);
  });

  it('computes fractional progress', () => {
    expect(getFlowProgress([])).toEqual({ completed: 0, total: 3, ratio: 0 });
    const twoOfThree = getFlowProgress(['WELCOME', 'PROFILE']);
    expect(twoOfThree.completed).toBe(2);
    expect(twoOfThree.ratio).toBeCloseTo(2 / 3);
  });
});

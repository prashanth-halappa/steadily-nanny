/**
 * @module domains/setup/__tests__/setupTypes.test
 *
 * The client-only role-fork step machine (`domains/setup/types`) — WS-F
 * extended every role's sequence with two shared permission-priming steps
 * (NOTIFICATIONS_PERMISSION, CALENDAR_PERMISSION). Locks in the exact order
 * per role, that every step has a route, that `getNextSetupStep` chains
 * correctly to the true end of each sequence, and that the last step of
 * every sequence always reports full progress.
 */
import { describe, expect, it } from 'bun:test';
import {
  getNextSetupStep,
  getSetupStepRoute,
  getStepProgress,
  SETUP_ROLES,
  SETUP_STEP_ROUTES,
  SETUP_STEPS,
  stepsForRole,
} from '../types';

describe('stepsForRole', () => {
  it('parent: role -> children -> invite -> notifications -> calendar', () => {
    expect(stepsForRole(SETUP_ROLES.PARENT)).toEqual([
      SETUP_STEPS.ROLE,
      SETUP_STEPS.CHILDREN,
      SETUP_STEPS.INVITE,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
      SETUP_STEPS.CALENDAR_PERMISSION,
    ]);
  });

  it('nanny: role -> code -> availability -> notifications -> calendar', () => {
    expect(stepsForRole(SETUP_ROLES.NANNY)).toEqual([
      SETUP_STEPS.ROLE,
      SETUP_STEPS.CODE,
      SETUP_STEPS.AVAILABILITY,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
      SETUP_STEPS.CALENDAR_PERMISSION,
    ]);
  });

  it('helper: role -> code -> notifications (no availability, no calendar)', () => {
    expect(stepsForRole(SETUP_ROLES.HELPER)).toEqual([
      SETUP_STEPS.ROLE,
      SETUP_STEPS.CODE,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
    ]);
  });

  it('null role: just the role fork', () => {
    expect(stepsForRole(null)).toEqual([SETUP_STEPS.ROLE]);
  });
});

describe('SETUP_STEP_ROUTES', () => {
  it('has a route entry for every step, including the two new ones', () => {
    for (const step of Object.values(SETUP_STEPS)) {
      expect(typeof getSetupStepRoute(step)).toBe('string');
      expect(getSetupStepRoute(step).length).toBeGreaterThan(0);
    }
    expect(SETUP_STEP_ROUTES.NOTIFICATIONS_PERMISSION).toBe(
      '/onboarding/notifications'
    );
    expect(SETUP_STEP_ROUTES.CALENDAR_PERMISSION).toBe('/onboarding/calendar');
  });
});

describe('getNextSetupStep', () => {
  it('chains a parent all the way to calendar, then stops', () => {
    expect(getNextSetupStep(SETUP_ROLES.PARENT, SETUP_STEPS.ROLE)).toBe(
      SETUP_STEPS.CHILDREN
    );
    expect(getNextSetupStep(SETUP_ROLES.PARENT, SETUP_STEPS.INVITE)).toBe(
      SETUP_STEPS.NOTIFICATIONS_PERMISSION
    );
    expect(
      getNextSetupStep(SETUP_ROLES.PARENT, SETUP_STEPS.NOTIFICATIONS_PERMISSION)
    ).toBe(SETUP_STEPS.CALENDAR_PERMISSION);
    expect(
      getNextSetupStep(SETUP_ROLES.PARENT, SETUP_STEPS.CALENDAR_PERMISSION)
    ).toBeNull();
  });

  it('a helper stops after notifications — no calendar step to chain to', () => {
    expect(getNextSetupStep(SETUP_ROLES.HELPER, SETUP_STEPS.CODE)).toBe(
      SETUP_STEPS.NOTIFICATIONS_PERMISSION
    );
    expect(
      getNextSetupStep(SETUP_ROLES.HELPER, SETUP_STEPS.NOTIFICATIONS_PERMISSION)
    ).toBeNull();
  });

  it('a nanny chains through availability to notifications and calendar', () => {
    expect(getNextSetupStep(SETUP_ROLES.NANNY, SETUP_STEPS.CODE)).toBe(
      SETUP_STEPS.AVAILABILITY
    );
    expect(getNextSetupStep(SETUP_ROLES.NANNY, SETUP_STEPS.AVAILABILITY)).toBe(
      SETUP_STEPS.NOTIFICATIONS_PERMISSION
    );
  });
});

describe('getStepProgress', () => {
  it('the last step of every role sequence always reports full progress', () => {
    expect(
      getStepProgress(SETUP_ROLES.PARENT, SETUP_STEPS.CALENDAR_PERMISSION)
    ).toBe(1);
    expect(
      getStepProgress(SETUP_ROLES.NANNY, SETUP_STEPS.CALENDAR_PERMISSION)
    ).toBe(1);
    expect(
      getStepProgress(SETUP_ROLES.HELPER, SETUP_STEPS.NOTIFICATIONS_PERMISSION)
    ).toBe(1);
  });

  it('progress increases monotonically through a role sequence', () => {
    const steps = stepsForRole(SETUP_ROLES.PARENT);
    const progressValues = steps.map(step =>
      getStepProgress(SETUP_ROLES.PARENT, step)
    );
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThan(
        progressValues[i - 1] as number
      );
    }
  });
});

import { describe, expect, it } from 'bun:test';
import {
  getUnfinishedSetupResumeRoute,
  SETUP_ROLES,
  SETUP_STEPS,
} from '../index';

describe('getUnfinishedSetupResumeRoute', () => {
  it('returns null when no role has been chosen', () => {
    expect(getUnfinishedSetupResumeRoute(null, SETUP_STEPS.INVITE)).toBeNull();
  });

  it('resumes a parent mid-wizard at the persisted step', () => {
    expect(
      getUnfinishedSetupResumeRoute(SETUP_ROLES.PARENT, SETUP_STEPS.INVITE)
    ).toBe('/onboarding/invite');
  });

  it('returns null for a parent on the final calendar step', () => {
    expect(
      getUnfinishedSetupResumeRoute(
        SETUP_ROLES.PARENT,
        SETUP_STEPS.CALENDAR_PERMISSION
      )
    ).toBeNull();
  });

  it('returns null for a helper on the final notifications step', () => {
    expect(
      getUnfinishedSetupResumeRoute(
        SETUP_ROLES.HELPER,
        SETUP_STEPS.NOTIFICATIONS_PERMISSION
      )
    ).toBeNull();
  });

  it('returns null when the step does not belong to the role sequence', () => {
    expect(
      getUnfinishedSetupResumeRoute(SETUP_ROLES.PARENT, SETUP_STEPS.CODE)
    ).toBeNull();
  });
});

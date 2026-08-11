import { describe, expect, it } from 'bun:test';
import {
  getUnfinishedSetupResumeRoute,
  SETUP_PATHS,
  SETUP_ROLES,
  SETUP_STEPS,
} from '../index';

describe('getUnfinishedSetupResumeRoute', () => {
  it('returns null when no role has been chosen', () => {
    expect(
      getUnfinishedSetupResumeRoute(null, null, SETUP_STEPS.INVITE)
    ).toBeNull();
  });

  it('resumes a creating parent mid-wizard at the persisted step', () => {
    expect(
      getUnfinishedSetupResumeRoute(
        SETUP_ROLES.PARENT,
        SETUP_PATHS.CREATE,
        SETUP_STEPS.INVITE
      )
    ).toBe('/onboarding/invite');
  });

  it('resumes a role-picked-but-path-unpicked user at the start fork', () => {
    expect(
      getUnfinishedSetupResumeRoute(SETUP_ROLES.NANNY, null, SETUP_STEPS.START)
    ).toBe('/onboarding/start');
  });

  it('returns null for a parent on the final calendar step', () => {
    expect(
      getUnfinishedSetupResumeRoute(
        SETUP_ROLES.PARENT,
        SETUP_PATHS.CREATE,
        SETUP_STEPS.CALENDAR_PERMISSION
      )
    ).toBeNull();
  });

  it('returns null for a helper on the final notifications step', () => {
    expect(
      getUnfinishedSetupResumeRoute(
        SETUP_ROLES.HELPER,
        SETUP_PATHS.JOIN,
        SETUP_STEPS.NOTIFICATIONS_PERMISSION
      )
    ).toBeNull();
  });

  it('returns null when the step does not belong to this role x path sequence', () => {
    // CODE is a real step — just not one a CREATING parent ever sees. A stale
    // persisted step from a path the user has since changed must not resume.
    expect(
      getUnfinishedSetupResumeRoute(
        SETUP_ROLES.PARENT,
        SETUP_PATHS.CREATE,
        SETUP_STEPS.CODE
      )
    ).toBeNull();
    expect(
      getUnfinishedSetupResumeRoute(
        SETUP_ROLES.PARENT,
        SETUP_PATHS.JOIN,
        SETUP_STEPS.CHILDREN
      )
    ).toBeNull();
  });
});

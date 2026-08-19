/**
 * @module domains/setup/__tests__/setupTypes.test
 *
 * The client-only step machine (`domains/setup/types`). D-33 made it
 * role x path rather than role-alone: `stepsForRole(role)` became
 * `stepsFor(role, path)`, and BOTH a parent and a nanny can now either create
 * a household or join one with a code. Locks in the exact four sequences plus
 * the helper row from `screens-onboarding-terms-proposal.md` §3.3, that every
 * step has a route, that `getNextSetupStep` chains to the true end of each
 * sequence, and that the last step of every sequence reports full progress.
 *
 * `entryStepFor` is the single role x path -> first-working-step mapping. It
 * exists because that mapping was hardcoded in three separate places
 * (RoleScreen, app/index.tsx, CodeEntryScreen's post-redeem fallback) and the
 * three had already drifted apart.
 */
import { describe, expect, it } from 'bun:test';
import {
  entryStepFor,
  getNextSetupStep,
  getSetupStepRoute,
  getStepProgress,
  getUnfinishedSetupResumeRoute,
  isSetupStepAfterCode,
  SETUP_PATHS,
  SETUP_ROLES,
  SETUP_STEP_ROUTES,
  SETUP_STEPS,
  stepsFor,
} from '../types';

describe('stepsFor — the four D-33 sequences', () => {
  it('parent · create: role -> start -> household -> children -> invite -> notifications -> calendar', () => {
    expect(stepsFor(SETUP_ROLES.PARENT, SETUP_PATHS.CREATE)).toEqual([
      SETUP_STEPS.ROLE,
      SETUP_STEPS.START,
      SETUP_STEPS.HOUSEHOLD,
      SETUP_STEPS.CHILDREN,
      SETUP_STEPS.INVITE,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
      SETUP_STEPS.CALENDAR_PERMISSION,
    ]);
  });

  it('parent · join: role -> start -> code -> notifications -> calendar (never children — that would make a second household)', () => {
    expect(stepsFor(SETUP_ROLES.PARENT, SETUP_PATHS.JOIN)).toEqual([
      SETUP_STEPS.ROLE,
      SETUP_STEPS.START,
      SETUP_STEPS.CODE,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
      SETUP_STEPS.CALENDAR_PERMISSION,
    ]);
    expect(stepsFor(SETUP_ROLES.PARENT, SETUP_PATHS.JOIN)).not.toContain(
      SETUP_STEPS.CHILDREN
    );
  });

  it('nanny · create: role -> start -> terms -> availability -> INVITE -> notifications -> calendar', () => {
    expect(stepsFor(SETUP_ROLES.NANNY, SETUP_PATHS.CREATE)).toEqual([
      SETUP_STEPS.ROLE,
      SETUP_STEPS.START,
      SETUP_STEPS.TERMS,
      SETUP_STEPS.AVAILABILITY,
      SETUP_STEPS.INVITE,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
      SETUP_STEPS.CALENDAR_PERMISSION,
    ]);
  });

  it('gives a creating nanny the invite step a creating parent has always had', () => {
    // She had none: signed up, made a draft, wrote her terms, and the wizard
    // never once offered her a way to send them to a family.
    expect(stepsFor(SETUP_ROLES.NANNY, SETUP_PATHS.CREATE)).toContain(
      SETUP_STEPS.INVITE
    );
    // A JOINING nanny already has a family — there is nobody for her to
    // invite, so the step stays out of that sequence.
    expect(stepsFor(SETUP_ROLES.NANNY, SETUP_PATHS.JOIN)).not.toContain(
      SETUP_STEPS.INVITE
    );
  });

  it('nanny · join: role -> start -> code -> availability -> notifications -> calendar', () => {
    expect(stepsFor(SETUP_ROLES.NANNY, SETUP_PATHS.JOIN)).toEqual([
      SETUP_STEPS.ROLE,
      SETUP_STEPS.START,
      SETUP_STEPS.CODE,
      SETUP_STEPS.AVAILABILITY,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
      SETUP_STEPS.CALENDAR_PERMISSION,
    ]);
  });

  it('helper: role -> start -> code -> notifications, whichever path was picked (the role is only ever resolved at redeem)', () => {
    const helperSequence = [
      SETUP_STEPS.ROLE,
      SETUP_STEPS.START,
      SETUP_STEPS.CODE,
      SETUP_STEPS.NOTIFICATIONS_PERMISSION,
    ];
    expect(stepsFor(SETUP_ROLES.HELPER, SETUP_PATHS.JOIN)).toEqual(
      helperSequence
    );
    expect(stepsFor(SETUP_ROLES.HELPER, SETUP_PATHS.CREATE)).toEqual(
      helperSequence
    );
  });

  it('no role yet: just the role fork', () => {
    expect(stepsFor(null, null)).toEqual([SETUP_STEPS.ROLE]);
    expect(stepsFor(null, SETUP_PATHS.CREATE)).toEqual([SETUP_STEPS.ROLE]);
  });

  it('role picked but no path yet: the start fork is the only next step', () => {
    expect(stepsFor(SETUP_ROLES.PARENT, null)).toEqual([
      SETUP_STEPS.ROLE,
      SETUP_STEPS.START,
    ]);
    expect(stepsFor(SETUP_ROLES.NANNY, null)).toEqual([
      SETUP_STEPS.ROLE,
      SETUP_STEPS.START,
    ]);
  });
});

describe('entryStepFor', () => {
  it('is the step right after START for every role x path', () => {
    expect(entryStepFor(SETUP_ROLES.PARENT, SETUP_PATHS.CREATE)).toBe(
      SETUP_STEPS.HOUSEHOLD
    );
    expect(entryStepFor(SETUP_ROLES.PARENT, SETUP_PATHS.JOIN)).toBe(
      SETUP_STEPS.CODE
    );
    expect(entryStepFor(SETUP_ROLES.NANNY, SETUP_PATHS.CREATE)).toBe(
      SETUP_STEPS.TERMS
    );
    expect(entryStepFor(SETUP_ROLES.NANNY, SETUP_PATHS.JOIN)).toBe(
      SETUP_STEPS.CODE
    );
    expect(entryStepFor(SETUP_ROLES.HELPER, SETUP_PATHS.JOIN)).toBe(
      SETUP_STEPS.CODE
    );
  });

  it('falls back to the last step the machine can name — never off the end of the sequence', () => {
    expect(entryStepFor(null, null)).toBe(SETUP_STEPS.ROLE);
    expect(entryStepFor(SETUP_ROLES.PARENT, null)).toBe(SETUP_STEPS.START);
  });
});

describe('SETUP_STEP_ROUTES', () => {
  it('has a route entry for every step, including START, HOUSEHOLD and TERMS', () => {
    for (const step of Object.values(SETUP_STEPS)) {
      expect(typeof getSetupStepRoute(step)).toBe('string');
      expect(getSetupStepRoute(step).length).toBeGreaterThan(0);
    }
    expect(SETUP_STEP_ROUTES.START).toBe('/onboarding/start');
    expect(SETUP_STEP_ROUTES.HOUSEHOLD).toBe('/onboarding/household');
    expect(SETUP_STEP_ROUTES.TERMS).toBe('/(private)/draft/terms');
    expect(SETUP_STEP_ROUTES.NOTIFICATIONS_PERMISSION).toBe(
      '/onboarding/notifications'
    );
    expect(SETUP_STEP_ROUTES.CALENDAR_PERMISSION).toBe('/onboarding/calendar');
  });

  it('sends a creating nanny to the DRAFT invite screen, never the parent one', () => {
    // `/onboarding/invite` asks which role the code grants and offers to
    // attach a pay offer — neither is a question she can answer — and it sits
    // under `onboarding/_layout`, which bounces a user the server already
    // calls onboarded, which she is.
    expect(
      getSetupStepRoute(
        SETUP_STEPS.INVITE,
        SETUP_ROLES.NANNY,
        SETUP_PATHS.CREATE
      )
    ).toBe('/(private)/draft/invite');
  });

  it('leaves every other role x path on the parent-shaped invite route', () => {
    expect(getSetupStepRoute(SETUP_STEPS.INVITE)).toBe('/onboarding/invite');
    expect(
      getSetupStepRoute(
        SETUP_STEPS.INVITE,
        SETUP_ROLES.PARENT,
        SETUP_PATHS.CREATE
      )
    ).toBe('/onboarding/invite');
    expect(
      getSetupStepRoute(SETUP_STEPS.INVITE, SETUP_ROLES.NANNY, SETUP_PATHS.JOIN)
    ).toBe('/onboarding/invite');
  });

  it('overrides only the steps that need it — a creating nanny still shares the permission routes', () => {
    expect(
      getSetupStepRoute(
        SETUP_STEPS.NOTIFICATIONS_PERMISSION,
        SETUP_ROLES.NANNY,
        SETUP_PATHS.CREATE
      )
    ).toBe('/onboarding/notifications');
  });
});

describe('getUnfinishedSetupResumeRoute — resuming a creating nanny', () => {
  it('resumes her INVITE step at the draft screen, not the parent one', () => {
    expect(
      getUnfinishedSetupResumeRoute(
        SETUP_ROLES.NANNY,
        SETUP_PATHS.CREATE,
        SETUP_STEPS.INVITE
      )
    ).toBe('/(private)/draft/invite');
  });
});

describe('getNextSetupStep', () => {
  it('chains a creating parent all the way to calendar, then stops', () => {
    const next = (step: (typeof SETUP_STEPS)[keyof typeof SETUP_STEPS]) =>
      getNextSetupStep(SETUP_ROLES.PARENT, SETUP_PATHS.CREATE, step);
    expect(next(SETUP_STEPS.ROLE)).toBe(SETUP_STEPS.START);
    expect(next(SETUP_STEPS.START)).toBe(SETUP_STEPS.HOUSEHOLD);
    expect(next(SETUP_STEPS.HOUSEHOLD)).toBe(SETUP_STEPS.CHILDREN);
    expect(next(SETUP_STEPS.INVITE)).toBe(SETUP_STEPS.NOTIFICATIONS_PERMISSION);
    expect(next(SETUP_STEPS.CALENDAR_PERMISSION)).toBeNull();
  });

  it('a JOINING co-parent leaves CODE for notifications — no fallback needed, CODE is in their sequence now', () => {
    expect(
      getNextSetupStep(SETUP_ROLES.PARENT, SETUP_PATHS.JOIN, SETUP_STEPS.CODE)
    ).toBe(SETUP_STEPS.NOTIFICATIONS_PERMISSION);
  });

  it('a helper stops after notifications — no calendar step to chain to', () => {
    expect(
      getNextSetupStep(SETUP_ROLES.HELPER, SETUP_PATHS.JOIN, SETUP_STEPS.CODE)
    ).toBe(SETUP_STEPS.NOTIFICATIONS_PERMISSION);
    expect(
      getNextSetupStep(
        SETUP_ROLES.HELPER,
        SETUP_PATHS.JOIN,
        SETUP_STEPS.NOTIFICATIONS_PERMISSION
      )
    ).toBeNull();
  });

  it('a joining nanny chains through availability to notifications and calendar', () => {
    expect(
      getNextSetupStep(SETUP_ROLES.NANNY, SETUP_PATHS.JOIN, SETUP_STEPS.CODE)
    ).toBe(SETUP_STEPS.AVAILABILITY);
    expect(
      getNextSetupStep(
        SETUP_ROLES.NANNY,
        SETUP_PATHS.JOIN,
        SETUP_STEPS.AVAILABILITY
      )
    ).toBe(SETUP_STEPS.NOTIFICATIONS_PERMISSION);
  });

  it('an authoring nanny chains terms -> availability -> invite -> notifications', () => {
    const next = (step: (typeof SETUP_STEPS)[keyof typeof SETUP_STEPS]) =>
      getNextSetupStep(SETUP_ROLES.NANNY, SETUP_PATHS.CREATE, step);
    expect(next(SETUP_STEPS.TERMS)).toBe(SETUP_STEPS.AVAILABILITY);
    // The link in the chain she did not have. AvailabilityScreen used to
    // name NOTIFICATIONS_PERMISSION directly, which would have stepped
    // straight over this.
    expect(next(SETUP_STEPS.AVAILABILITY)).toBe(SETUP_STEPS.INVITE);
    expect(next(SETUP_STEPS.INVITE)).toBe(SETUP_STEPS.NOTIFICATIONS_PERMISSION);
  });
});

describe('getStepProgress', () => {
  it('the last step of every sequence reports full progress', () => {
    expect(
      getStepProgress(
        SETUP_ROLES.PARENT,
        SETUP_PATHS.CREATE,
        SETUP_STEPS.CALENDAR_PERMISSION
      )
    ).toBe(1);
    expect(
      getStepProgress(
        SETUP_ROLES.NANNY,
        SETUP_PATHS.CREATE,
        SETUP_STEPS.CALENDAR_PERMISSION
      )
    ).toBe(1);
    expect(
      getStepProgress(
        SETUP_ROLES.HELPER,
        SETUP_PATHS.JOIN,
        SETUP_STEPS.NOTIFICATIONS_PERMISSION
      )
    ).toBe(1);
  });

  it('progress increases monotonically through every sequence', () => {
    for (const role of [SETUP_ROLES.PARENT, SETUP_ROLES.NANNY]) {
      for (const path of [SETUP_PATHS.CREATE, SETUP_PATHS.JOIN]) {
        const values = stepsFor(role, path).map(step =>
          getStepProgress(role, path, step)
        );
        for (let i = 1; i < values.length; i++) {
          expect(values[i]).toBeGreaterThan(values[i - 1] as number);
        }
      }
    }
  });
});

describe('isSetupStepAfterCode', () => {
  it('is true when persisted progress has moved past CODE on the join path', () => {
    expect(
      isSetupStepAfterCode(
        SETUP_ROLES.PARENT,
        SETUP_PATHS.JOIN,
        SETUP_STEPS.NOTIFICATIONS_PERMISSION
      )
    ).toBe(true);
  });

  it('is false while the user is still on CODE', () => {
    expect(
      isSetupStepAfterCode(
        SETUP_ROLES.PARENT,
        SETUP_PATHS.JOIN,
        SETUP_STEPS.CODE
      )
    ).toBe(false);
  });
});

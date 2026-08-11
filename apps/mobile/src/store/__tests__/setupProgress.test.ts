import { beforeEach, describe, expect, it } from 'bun:test';
import {
  SETUP_PATHS,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { migrateSetupProgress, useSetupProgressStore } from '../setupProgress';

beforeEach(() => {
  useSetupProgressStore.getState().reset();
});

describe('useSetupProgressStore', () => {
  it('starts on the ROLE step with no role and no path chosen', () => {
    const state = useSetupProgressStore.getState();
    expect(state.role).toBeNull();
    expect(state.path).toBeNull();
    expect(state.currentStep).toBe(SETUP_STEPS.ROLE);
    expect(state.householdId).toBeNull();
  });

  it('records the chosen role', () => {
    useSetupProgressStore.getState().setRole(SETUP_ROLES.NANNY);
    expect(useSetupProgressStore.getState().role).toBe(SETUP_ROLES.NANNY);
  });

  it('records the chosen path independently of the role', () => {
    useSetupProgressStore.getState().setRole(SETUP_ROLES.NANNY);
    useSetupProgressStore.getState().setPath(SETUP_PATHS.CREATE);

    const state = useSetupProgressStore.getState();
    expect(state.role).toBe(SETUP_ROLES.NANNY);
    expect(state.path).toBe(SETUP_PATHS.CREATE);
  });

  it('advances currentStep and caches the household id', () => {
    useSetupProgressStore.getState().setCurrentStep(SETUP_STEPS.CHILDREN);
    useSetupProgressStore.getState().setHouseholdId('household-1');

    const state = useSetupProgressStore.getState();
    expect(state.currentStep).toBe(SETUP_STEPS.CHILDREN);
    expect(state.householdId).toBe('household-1');
  });

  it('reset() restores the initial state, path included', () => {
    useSetupProgressStore.getState().setRole(SETUP_ROLES.PARENT);
    useSetupProgressStore.getState().setPath(SETUP_PATHS.JOIN);
    useSetupProgressStore.getState().setHouseholdId('household-1');

    useSetupProgressStore.getState().reset();

    const state = useSetupProgressStore.getState();
    expect(state.role).toBeNull();
    expect(state.path).toBeNull();
    expect(state.currentStep).toBe(SETUP_STEPS.ROLE);
    expect(state.householdId).toBeNull();
  });
});

describe('migrateSetupProgress — v1 (role-only) -> v2 (role x path)', () => {
  it('infers create for a parent mid-wizard, preserving their old sequence', () => {
    const migrated = migrateSetupProgress(
      {
        role: SETUP_ROLES.PARENT,
        currentStep: SETUP_STEPS.CHILDREN,
        householdId: 'household-1',
      },
      1
    );

    expect(migrated.path).toBe(SETUP_PATHS.CREATE);
    expect(migrated.role).toBe(SETUP_ROLES.PARENT);
    expect(migrated.currentStep).toBe(SETUP_STEPS.CHILDREN);
    expect(migrated.householdId).toBe('household-1');
  });

  it('infers join for a nanny and a helper — the only path v1 gave either of them', () => {
    expect(
      migrateSetupProgress(
        { role: SETUP_ROLES.NANNY, currentStep: SETUP_STEPS.CODE },
        1
      ).path
    ).toBe(SETUP_PATHS.JOIN);
    expect(
      migrateSetupProgress(
        { role: SETUP_ROLES.HELPER, currentStep: SETUP_STEPS.CODE },
        1
      ).path
    ).toBe(SETUP_PATHS.JOIN);
  });

  it('leaves path null when v1 had no role — that user has not forked yet', () => {
    expect(
      migrateSetupProgress({ role: null, currentStep: SETUP_STEPS.ROLE }, 0)
        .path
    ).toBeNull();
  });

  it('carries a v2 payload through untouched', () => {
    const v2 = {
      role: SETUP_ROLES.NANNY,
      path: SETUP_PATHS.CREATE,
      currentStep: SETUP_STEPS.TERMS,
      householdId: 'draft-1',
    };
    expect(migrateSetupProgress(v2, 2)).toEqual(v2);
  });

  it('falls back to a clean slate for an unknown/newer version', () => {
    const migrated = migrateSetupProgress(
      { role: SETUP_ROLES.PARENT, path: SETUP_PATHS.CREATE },
      99
    );
    expect(migrated.role).toBeNull();
    expect(migrated.path).toBeNull();
  });
});
